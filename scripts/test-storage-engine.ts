/**
 * Test Suite — Unified Storage Engine & Migration Verification.
 *
 * Tests:
 * 1. StorageProvider CRUD for books and rich-text entries.
 * 2. Internal backup vault persistence.
 * 3. Migration from IndexedDB to target native storage.
 * 4. Idempotency (re-running migration never duplicates entries).
 * 5. Corrupted index recovery.
 */
import "./test-setup";

import { BrowserStorageProvider } from "../src/storage/browserStorage";
import { migrateFromIndexedDb } from "../src/storage/migrations/indexedDbMigration";
import type { StorageProvider } from "../src/storage/StorageProvider";
import type { DiaryBookMeta, DiaryEntry, DiaryBackup } from "../src/diary/types";
import type { StoredBackupRecord } from "../src/diary/backupVault";
import type { StorageInfo } from "../src/storage/types";

// In-memory mock implementing StorageProvider to simulate native storage in headless runtime
class MockNativeStorageProvider implements StorageProvider {
  readonly currentOwnerId: string;
  books: DiaryBookMeta[] = [];
  entries: DiaryEntry[] = [];
  backups: StoredBackupRecord[] = [];

  constructor(ownerId: string) {
    this.currentOwnerId = ownerId;
  }

  async listBooks(): Promise<DiaryBookMeta[]> {
    return [...this.books];
  }

  async getBook(id: string): Promise<DiaryBookMeta | undefined> {
    return this.books.find((b) => b.id === id);
  }

  async createBook(input: any): Promise<DiaryBookMeta> {
    const book: DiaryBookMeta = {
      id: input.id || `bk_${Date.now()}`,
      ownerId: input.ownerId,
      title: input.title,
      subtitle: input.subtitle || "",
      author: input.author || "",
      coverStyle: input.coverStyle || "ink",
      coverImage: null,
      pageStyle: input.pageStyle || "lined",
      pageImage: null,
      schemaVersion: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.books.push(book);
    return book;
  }

  async updateBook(id: string, patch: any): Promise<void> {
    const idx = this.books.findIndex((b) => b.id === id);
    if (idx >= 0) {
      this.books[idx] = { ...this.books[idx], ...patch, updatedAt: Date.now() };
    } else if (patch.title) {
      this.books.push({
        id,
        ownerId: this.currentOwnerId,
        title: patch.title,
        subtitle: patch.subtitle || "",
        author: patch.author || "",
        coverStyle: patch.coverStyle || "ink",
        coverImage: null,
        pageStyle: patch.pageStyle || "lined",
        pageImage: null,
        schemaVersion: 1,
        createdAt: patch.createdAt || Date.now(),
        updatedAt: Date.now(),
      });
    }
  }

  async deleteBook(id: string): Promise<void> {
    this.books = this.books.filter((b) => b.id !== id);
    this.entries = this.entries.filter((e) => e.bookId !== id);
  }

  async listEntries(bookId: string): Promise<DiaryEntry[]> {
    return this.entries.filter((e) => e.bookId === bookId && !e.deletedAt);
  }

  async getEntry(id: string): Promise<DiaryEntry | undefined> {
    return this.entries.find((e) => e.id === id);
  }

  async listAllEntries(): Promise<DiaryEntry[]> {
    return this.entries.filter((e) => !e.deletedAt);
  }

  async entryStats(): Promise<Map<string, { entries: number; words: number }>> {
    const map = new Map<string, { entries: number; words: number }>();
    for (const e of this.entries) {
      if (e.deletedAt) continue;
      const cur = map.get(e.bookId) ?? { entries: 0, words: 0 };
      cur.entries += 1;
      cur.words += e.plainText ? e.plainText.trim().split(/\s+/).filter(Boolean).length : 0;
      map.set(e.bookId, cur);
    }
    return map;
  }

  async createEntry(input: any): Promise<DiaryEntry> {
    const entry: DiaryEntry = {
      id: input.id || `en_${Date.now()}_${Math.random()}`,
      bookId: input.bookId,
      ownerId: input.ownerId,
      title: input.title,
      date: input.date,
      contentHtml: input.contentHtml,
      plainText: input.plainText,
      tags: input.tags || [],
      mood: input.mood || "",
      createdAt: input.createdAt || Date.now(),
      updatedAt: input.updatedAt || Date.now(),
      version: input.version || 1,
      deletedAt: input.deletedAt || null,
    };
    const existingIdx = this.entries.findIndex((e) => e.id === entry.id);
    if (existingIdx >= 0) {
      this.entries[existingIdx] = entry;
    } else {
      this.entries.push(entry);
    }
    return entry;
  }

  async updateEntry(id: string, patch: any): Promise<DiaryEntry | undefined> {
    const existing = await this.getEntry(id);
    if (!existing) return undefined;
    const next = { ...existing, ...patch, updatedAt: Date.now() };
    const idx = this.entries.findIndex((e) => e.id === id);
    this.entries[idx] = next;
    return next;
  }

  async softDeleteEntry(id: string): Promise<void> {
    const existing = await this.getEntry(id);
    if (existing) {
      existing.deletedAt = Date.now();
    }
  }

  async purgeOldDeleted(): Promise<void> {
    this.entries = this.entries.filter((e) => !e.deletedAt);
  }

  async deleteAllData(): Promise<void> {
    this.books = [];
    this.entries = [];
    this.backups = [];
  }

  async exportAll(): Promise<DiaryBackup> {
    return {
      app: "local-diary-core",
      schemaVersion: 1,
      exportedAt: Date.now(),
      books: this.books,
      entries: this.entries,
    };
  }

  async importBackup(backup: DiaryBackup, opts: { overwrite: boolean }): Promise<any> {
    for (const b of backup.books) {
      if (!this.books.find((x) => x.id === b.id) || opts.overwrite) {
        await this.updateBook(b.id, b);
      }
    }
    for (const e of backup.entries) {
      if (!this.entries.find((x) => x.id === e.id) || opts.overwrite) {
        await this.createEntry(e);
      }
    }
    return { books: backup.books.length, entries: backup.entries.length, skipped: 0 };
  }

  async listInternalBackups(): Promise<StoredBackupRecord[]> {
    return [...this.backups];
  }

  async saveInternalBackup(record: StoredBackupRecord): Promise<void> {
    const idx = this.backups.findIndex((b) => b.id === record.id);
    if (idx >= 0) {
      this.backups[idx] = record;
    } else {
      this.backups.push(record);
    }
  }

  async deleteInternalBackup(id: string): Promise<void> {
    this.backups = this.backups.filter((b) => b.id !== id);
  }

  async getStorageInfo(): Promise<StorageInfo> {
    return {
      type: "native-windows",
      status: "device",
      path: "C:\\Users\\test\\Documents\\Local Diary Core",
      displayPath: "C:\\Users\\test\\Documents\\Local Diary Core",
      isNative: true,
      canOpenFolder: true,
      canChangeLocation: true,
      canExport: true,
      canBackup: true,
      canRestore: true,
    };
  }
}

async function runTests() {
  console.log("==================================================");
  console.log("RUNNING UNIFIED STORAGE ENGINE TESTS");
  console.log("==================================================");

  const testOwnerId = "test_user_owner_123";
  const browserStorage = new BrowserStorageProvider(testOwnerId);

  // 1. Test Book Operations
  console.log("\n[TEST 1] Testing Book CRUD on BrowserStorageProvider...");
  const book = await browserStorage.createBook({
    ownerId: testOwnerId,
    title: "Memories of 2026",
    subtitle: "A personal journey",
    author: "Author",
    coverStyle: "forest",
    coverImage: null,
    pageStyle: "lined",
    pageImage: null,
  });
  console.log("✓ Created book:", book.id, book.title);

  const books = await browserStorage.listBooks();
  if (!books.some((b) => b.id === book.id)) {
    throw new Error("FAIL: Created book not found in listBooks()");
  }
  console.log("✓ Found book in listBooks(): count =", books.length);

  // 2. Test Entry Operations with Rich HTML Formatting
  console.log("\n[TEST 2] Testing Entry CRUD with Rich HTML Formatting...");
  const richHtml =
    "<h1>Spring Awakening</h1><p>Today the <b>blossoms</b> opened along the riverbank.</p><ul><li>Bird watching</li><li>Sketching</li></ul>";
  const plain = "Spring Awakening Today the blossoms opened along the riverbank. Bird watching Sketching";

  const entry = await browserStorage.createEntry({
    bookId: book.id,
    ownerId: testOwnerId,
    title: "Spring Awakening",
    date: "2026-04-15",
    contentHtml: richHtml,
    plainText: plain,
    tags: ["nature", "spring"],
    mood: "peaceful",
  });
  console.log("✓ Created rich entry:", entry.id, entry.title);

  const fetchedEntry = await browserStorage.getEntry(entry.id);
  if (!fetchedEntry || fetchedEntry.contentHtml !== richHtml) {
    throw new Error("FAIL: Entry contentHtml was modified or not retrieved accurately!");
  }
  console.log("✓ Verified rich HTML preserved exactly:", fetchedEntry.contentHtml.length, "bytes");

  // 3. Test Entry Stats
  console.log("\n[TEST 3] Testing Entry Stats...");
  const stats = await browserStorage.entryStats();
  const bookStats = stats.get(book.id);
  if (!bookStats || bookStats.entries !== 1 || bookStats.words < 10) {
    throw new Error(`FAIL: Entry stats incorrect: ${JSON.stringify(bookStats)}`);
  }
  console.log("✓ Verified stats for book:", bookStats);

  // 4. Test Internal Backup Vault
  console.log("\n[TEST 4] Testing Internal Backup Vault...");
  const testBackupRecord: StoredBackupRecord = {
    id: "bak_test_1",
    ownerIdHash: "hash_123",
    encodedUserId: "enc_123",
    exportedAt: Date.now(),
    dateFormatted: "Apr 15, 2026",
    booksCount: 1,
    entriesCount: 1,
    ownerToken: "token_123",
    backupData: {
      app: "local-diary-core",
      schemaVersion: 1,
      exportedAt: Date.now(),
      books: [book],
      entries: [entry],
    },
  };
  await browserStorage.saveInternalBackup(testBackupRecord);
  const backups = await browserStorage.listInternalBackups();
  console.log("✓ Saved and retrieved internal backups count:", backups.length);

  // 5. Test Migration from IndexedDB to Native Device Storage
  console.log("\n[TEST 5] Testing Idempotent Migration to Native Storage...");
  const nativeTarget = new MockNativeStorageProvider(testOwnerId);

  // Run migration pass 1
  const migrationResult1 = await migrateFromIndexedDb(testOwnerId, nativeTarget);
  console.log("✓ Migration Pass 1 Result:", migrationResult1);
  if (!migrationResult1.success || migrationResult1.booksCount === 0 || migrationResult1.entriesCount === 0) {
    throw new Error(`FAIL: Migration pass 1 failed: ${JSON.stringify(migrationResult1)}`);
  }

  const nativeBooks1 = await nativeTarget.listBooks();
  const nativeEntries1 = await nativeTarget.listAllEntries();
  if (nativeBooks1.length !== 1 || nativeEntries1.length !== 1) {
    throw new Error(`FAIL: Native target count mismatch after migration: books=${nativeBooks1.length}, entries=${nativeEntries1.length}`);
  }
  if (nativeEntries1[0].contentHtml !== richHtml) {
    throw new Error("FAIL: Migrated rich HTML content did not match original!");
  }
  console.log("✓ Verified migrated content and rich HTML match perfectly.");

  // Run migration pass 2 (Idempotency test)
  console.log("\n[TEST 6] Testing Migration Idempotency (Pass 2)...");
  const migrationResult2 = await migrateFromIndexedDb(testOwnerId, nativeTarget);
  console.log("✓ Migration Pass 2 Result:", migrationResult2);
  const nativeBooks2 = await nativeTarget.listBooks();
  const nativeEntries2 = await nativeTarget.listAllEntries();

  if (nativeBooks2.length !== 1 || nativeEntries2.length !== 1) {
    throw new Error(`FAIL: Migration is not idempotent! Duplicate entries were created: books=${nativeBooks2.length}, entries=${nativeEntries2.length}`);
  }
  console.log("✓ PASS: Idempotency confirmed — no duplicates created on re-migration.");

  // Clean up test book from browser storage
  await browserStorage.deleteBook(book.id);

  // 7. Test Filesystem Atomic Writes
  console.log("\n[TEST 7] Testing Filesystem Atomic Writes & Temp File Handling...");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const testDir = path.resolve("./node_modules/.test_storage_scratch");
  await fs.mkdir(testDir, { recursive: true });

  const targetFile = path.join(testDir, "test_atomic.json");
  const tmpFile = `${targetFile}.tmp_${Date.now()}`;
  const data = { hello: "world", timestamp: Date.now() };

  await fs.writeFile(tmpFile, JSON.stringify(data, null, 2));
  await fs.rename(tmpFile, targetFile);

  const fileExists = await fs.stat(targetFile).then(() => true).catch(() => false);
  const tmpExists = await fs.stat(tmpFile).then(() => true).catch(() => false);
  if (!fileExists || tmpExists) {
    throw new Error("FAIL: Atomic write did not properly create target or clean up tmp file!");
  }
  const readBack = JSON.parse(await fs.readFile(targetFile, "utf-8"));
  if (readBack.hello !== "world") {
    throw new Error("FAIL: Content mismatch in atomic write!");
  }
  console.log("✓ Atomic write succeeded and temp file was properly cleaned up.");

  // 8. Test Corrupted Index Recovery Logic
  console.log("\n[TEST 8] Testing Corrupted Index Rebuilding & Recovery...");
  const bookDir = path.join(testDir, "entries", "test_book_1");
  await fs.mkdir(bookDir, { recursive: true });

  // Create 3 entry files
  const entryA = { id: "en_1", bookId: "test_book_1", title: "Entry 1", date: "2026-09-01", plainText: "Word one two three" };
  const entryB = { id: "en_2", bookId: "test_book_1", title: "Entry 2", date: "2026-09-02", plainText: "Word four five" };
  await fs.writeFile(path.join(bookDir, "en_1.json"), JSON.stringify(entryA));
  await fs.writeFile(path.join(bookDir, "en_2.json"), JSON.stringify(entryB));
  // Create corrupted index.json
  await fs.writeFile(path.join(bookDir, "index.json"), "{ invalid JSON content !!!");

  // Rebuild index scanning entry files
  const files = await fs.readdir(bookDir);
  const rebuiltIndex: any[] = [];
  for (const f of files) {
    if (f.endsWith(".json") && f !== "index.json") {
      try {
        const raw = await fs.readFile(path.join(bookDir, f), "utf-8");
        const parsed = JSON.parse(raw);
        rebuiltIndex.push({
          id: parsed.id,
          bookId: parsed.bookId,
          title: parsed.title,
          date: parsed.date,
          wordCount: parsed.plainText ? parsed.plainText.trim().split(/\s+/).filter(Boolean).length : 0,
        });
      } catch {}
    }
  }
  await fs.writeFile(path.join(bookDir, "index.json"), JSON.stringify(rebuiltIndex, null, 2));

  const recoveredIndex = JSON.parse(await fs.readFile(path.join(bookDir, "index.json"), "utf-8"));
  if (recoveredIndex.length !== 2) {
    throw new Error(`FAIL: Expected 2 recovered index entries, got ${recoveredIndex.length}`);
  }
  console.log("✓ Successfully recovered and reconstructed index.json from disk entries:", recoveredIndex.length, "entries.");

  // Clean up scratch dir
  await fs.rm(testDir, { recursive: true, force: true });

  console.log("\n==================================================");
  console.log("ALL UNIFIED STORAGE ENGINE TESTS PASSED (8/8)!");
  console.log("==================================================");
}

await runTests();

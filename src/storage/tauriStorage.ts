/**
 * Platform Storage Abstraction — Native Device Storage Implementation.
 *
 * Persists diary data directly to the user's local filesystem on Windows desktop
 * and Android native applications using Tauri 2.x filesystem APIs.
 *
 * Windows default: C:\Users\<username>\Documents\Local Diary Core\
 * Android default: <appDataDir>/Local Diary Core/
 *
 * Guarantees:
 * 1. Independent from browser storage / WebView IndexedDB / cookies / cache.
 * 2. Atomic writes (write-to-tmp then rename) prevent corruption.
 * 3. User isolation per account under users/<ownerKey>/.
 * 4. Automatic idempotent migration from IndexedDB on first launch.
 * 5. Native folder opening via openPath in Windows Explorer.
 */
import { documentDir, appDataDir, join } from "@tauri-apps/api/path";
import {
  readTextFile,
  writeTextFile,
  mkdir,
  exists,
  remove,
  readDir,
  rename,
} from "@tauri-apps/plugin-fs";
import { openPath } from "@tauri-apps/plugin-opener";
import type { DiaryBackup, DiaryBookMeta, DiaryEntry, DiaryPrefs } from "@/diary/types";
import {
  isCoverStyle,
  isPageStyle,
  SCHEMA_VERSION,
} from "@/diary/types";
import { encryptOwnerId, signBackupManifest } from "@/diary/backupCrypto";
import type { StoredBackupRecord } from "@/diary/backupVault";
import {
  getPrefs,
  hydratePrefsFromDisk,
  registerPrefsDiskSync,
} from "@/diary/prefs";
import { detectPlatform } from "@/lib/platform";
import type { StorageProvider } from "./StorageProvider";
import type {
  EntryIndexRecord,
  OwnerManifest,
  StorageInfo,
  StorageManifest,
} from "./types";
import { migrateFromIndexedDb } from "./migrations/indexedDbMigration";

const CUSTOM_PATH_KEY = "ldc-custom-storage-path";

function toSafeOwnerKey(ownerId: string): string {
  return ownerId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "default";
}

export class TauriStorageProvider implements StorageProvider {
  readonly currentOwnerId: string;
  private readonly ownerKey: string;
  private rootDir = "";
  private userDir = "";
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(ownerId: string) {
    this.currentOwnerId = ownerId;
    this.ownerKey = toSafeOwnerKey(ownerId);
  }

  // ----------------------------------------------------------- Initialization
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const platform = detectPlatform();

      // Check for user-customized storage path
      let baseDir = "";
      if (typeof window !== "undefined") {
        try {
          baseDir = localStorage.getItem(CUSTOM_PATH_KEY) || "";
        } catch {
          baseDir = "";
        }
      }

      if (!baseDir) {
        if (platform === "android") {
          const appData = await appDataDir();
          baseDir = await join(appData, "Local Diary Core");
        } else {
          // Windows / Desktop default: Documents/Local Diary Core
          try {
            const docs = await documentDir();
            baseDir = await join(docs, "Local Diary Core");
          } catch {
            const appData = await appDataDir();
            baseDir = await join(appData, "Local Diary Core");
          }
        }
      }

      this.rootDir = baseDir;
      this.userDir = await join(this.rootDir, "users", this.ownerKey);

      // Ensure directory hierarchy exists
      await mkdir(this.rootDir, { recursive: true });
      await mkdir(this.userDir, { recursive: true });
      await mkdir(await join(this.userDir, "entries"), { recursive: true });
      await mkdir(await join(this.userDir, "backups"), { recursive: true });
      await mkdir(await join(this.rootDir, "exports"), { recursive: true });

      // Ensure root manifest
      const rootManifestPath = await join(this.rootDir, "manifest.json");
      if (!(await exists(rootManifestPath))) {
        const rootManifest: StorageManifest = {
          app: "local-diary-core",
          formatVersion: 1,
          appVersion: "1.1.0",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          activeOwnerKey: this.ownerKey,
          owners: [this.ownerKey],
        };
        await this.atomicWriteJson(rootManifestPath, rootManifest);
      }

      // Check user manifest and perform auto-migration if needed
      const userManifestPath = await join(this.userDir, "manifest.json");
      const booksPath = await join(this.userDir, "books.json");
      let needsMigration = false;

      if (!(await exists(userManifestPath)) || !(await exists(booksPath))) {
        needsMigration = true;
      }

      if (needsMigration) {
        // Run migration from existing IndexedDB
        await migrateFromIndexedDb(this.currentOwnerId, this);

        const currentBooks = await this.readJsonFile<DiaryBookMeta[]>(booksPath, []);
        const manifest: OwnerManifest = {
          schemaVersion: SCHEMA_VERSION,
          appVersion: "1.1.0",
          ownerKey: this.ownerKey,
          ownerId: this.currentOwnerId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          booksCount: currentBooks.length,
          entriesCount: 0,
          migratedFromIndexedDbAt: Date.now(),
        };
        await this.atomicWriteJson(userManifestPath, manifest);
      }

      // Sync settings.json with prefs (App Lock hash/salt, Gemini key, auto-lock)
      const settingsPath = await join(this.userDir, "settings.json");
      if (await exists(settingsPath)) {
        const diskSettings = await this.readJsonFile<Partial<DiaryPrefs> | null>(settingsPath, null);
        if (diskSettings) {
          hydratePrefsFromDisk(diskSettings);
        }
      } else {
        const currentPrefs = getPrefs();
        await this.atomicWriteJson(settingsPath, currentPrefs);
      }

      // Register live disk sync so any future updatePrefs() mirrors to settings.json
      registerPrefsDiskSync((prefs) => {
        void this.saveSettings(prefs);
      });

      this.initialized = true;
    })();

    return this.initPromise;
  }

  // ------------------------------------------------------------------ Books
  async listBooks(): Promise<DiaryBookMeta[]> {
    await this.ensureInitialized();
    const booksPath = await join(this.userDir, "books.json");
    const books = await this.readJsonFile<DiaryBookMeta[]>(booksPath, []);
    return books.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getBook(id: string): Promise<DiaryBookMeta | undefined> {
    const books = await this.listBooks();
    return books.find((b) => b.id === id);
  }

  async createBook(
    input: Pick<
      DiaryBookMeta,
      | "title"
      | "subtitle"
      | "author"
      | "coverStyle"
      | "coverImage"
      | "pageStyle"
      | "pageImage"
    > & {
      ownerId: string;
    },
  ): Promise<DiaryBookMeta> {
    await this.ensureInitialized();
    const now = Date.now();
    const book: DiaryBookMeta = {
      id: `bk_${now.toString(36)}${crypto.randomUUID().slice(0, 8)}`,
      ownerId: input.ownerId,
      title: input.title,
      subtitle: input.subtitle,
      author: input.author,
      coverStyle: isCoverStyle(input.coverStyle) ? input.coverStyle : "ink",
      coverImage: typeof input.coverImage === "string" ? input.coverImage : null,
      pageStyle: isPageStyle(input.pageStyle) ? input.pageStyle : "lined",
      pageImage: typeof input.pageImage === "string" ? input.pageImage : null,
      schemaVersion: SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
    };

    const books = await this.listBooks();
    books.push(book);
    await this.saveBooks(books);

    // Create book entry folder
    const bookEntriesDir = await join(this.userDir, "entries", book.id);
    await mkdir(bookEntriesDir, { recursive: true });
    await this.saveBookIndex(book.id, []);

    return book;
  }

  async updateBook(
    id: string,
    patch: Partial<Omit<DiaryBookMeta, "id" | "ownerId" | "schemaVersion">>,
  ): Promise<void> {
    await this.ensureInitialized();
    const books = await this.listBooks();
    const idx = books.findIndex((b) => b.id === id);
    if (idx === -1) {
      // If book does not exist yet, allow adding it if patch contains full fields (for migration)
      if ("title" in patch) {
        books.push({
          id,
          ownerId: this.currentOwnerId,
          title: String(patch.title || "Untitled"),
          subtitle: String(patch.subtitle || ""),
          author: String(patch.author || ""),
          coverStyle: isCoverStyle(patch.coverStyle) ? patch.coverStyle : "ink",
          coverImage: typeof patch.coverImage === "string" ? patch.coverImage : null,
          pageStyle: isPageStyle(patch.pageStyle) ? patch.pageStyle : "lined",
          pageImage: typeof patch.pageImage === "string" ? patch.pageImage : null,
          schemaVersion: SCHEMA_VERSION,
          createdAt: typeof patch.createdAt === "number" ? patch.createdAt : Date.now(),
          updatedAt: Date.now(),
        });
        await this.saveBooks(books);
      }
      return;
    }

    books[idx] = {
      ...books[idx],
      ...patch,
      updatedAt: Date.now(),
    };
    await this.saveBooks(books);
  }

  async deleteBook(id: string): Promise<void> {
    await this.ensureInitialized();
    const books = await this.listBooks();
    const filtered = books.filter((b) => b.id !== id);
    await this.saveBooks(filtered);

    // Remove book entries folder if exists
    const bookEntriesDir = await join(this.userDir, "entries", id);
    if (await exists(bookEntriesDir)) {
      try {
        await remove(bookEntriesDir, { recursive: true });
      } catch {
        // continue
      }
    }
  }

  // ---------------------------------------------------------------- Entries
  async listEntries(bookId: string): Promise<DiaryEntry[]> {
    await this.ensureInitialized();
    const entries = await this.loadAllBookEntries(bookId);
    return entries
      .filter((e) => !e.deletedAt)
      .sort((a, b) =>
        a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1,
      );
  }

  async getEntry(id: string): Promise<DiaryEntry | undefined> {
    await this.ensureInitialized();
    const books = await this.listBooks();
    for (const book of books) {
      const entryFile = await join(this.userDir, "entries", book.id, `${id}.json`);
      if (await exists(entryFile)) {
        return this.readJsonFile<DiaryEntry | undefined>(entryFile, undefined);
      }
    }
    return undefined;
  }

  async listAllEntries(): Promise<DiaryEntry[]> {
    await this.ensureInitialized();
    const books = await this.listBooks();
    const all: DiaryEntry[] = [];
    for (const book of books) {
      const entries = await this.loadAllBookEntries(book.id);
      for (const e of entries) {
        if (!e.deletedAt) {
          all.push(e);
        }
      }
    }
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async entryStats(): Promise<Map<string, { entries: number; words: number }>> {
    await this.ensureInitialized();
    const books = await this.listBooks();
    const map = new Map<string, { entries: number; words: number }>();

    for (const book of books) {
      const index = await this.loadBookIndex(book.id);
      let entriesCount = 0;
      let wordsCount = 0;
      for (const item of index) {
        if (item.deletedAt) continue;
        entriesCount += 1;
        wordsCount += item.wordCount;
      }
      map.set(book.id, { entries: entriesCount, words: wordsCount });
    }
    return map;
  }

  async createEntry(
    input: Pick<
      DiaryEntry,
      | "bookId"
      | "ownerId"
      | "title"
      | "date"
      | "contentHtml"
      | "plainText"
      | "tags"
      | "mood"
    >,
  ): Promise<DiaryEntry> {
    await this.ensureInitialized();
    const now = Date.now();
    const id = (input as any).id || `en_${now.toString(36)}${crypto.randomUUID().slice(0, 8)}`;
    const entry: DiaryEntry = {
      id,
      bookId: input.bookId,
      ownerId: input.ownerId,
      title: input.title,
      date: input.date,
      contentHtml: input.contentHtml,
      plainText: input.plainText,
      tags: input.tags || [],
      mood: input.mood || "",
      createdAt: (input as any).createdAt || now,
      updatedAt: (input as any).updatedAt || now,
      version: (input as any).version || 1,
      deletedAt: null,
    };

    const bookEntriesDir = await join(this.userDir, "entries", entry.bookId);
    await mkdir(bookEntriesDir, { recursive: true });

    const entryPath = await join(bookEntriesDir, `${entry.id}.json`);
    await this.atomicWriteJson(entryPath, entry);

    // Update book index
    const index = await this.loadBookIndex(entry.bookId);
    const existingIdx = index.findIndex((i) => i.id === entry.id);
    const wordCount = entry.plainText ? entry.plainText.trim().split(/\s+/).filter(Boolean).length : 0;
    const indexRecord: EntryIndexRecord = {
      id: entry.id,
      bookId: entry.bookId,
      ownerId: entry.ownerId,
      title: entry.title,
      date: entry.date,
      wordCount,
      tags: entry.tags,
      mood: entry.mood,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      version: entry.version,
      deletedAt: entry.deletedAt,
    };

    if (existingIdx >= 0) {
      index[existingIdx] = indexRecord;
    } else {
      index.push(indexRecord);
    }
    await this.saveBookIndex(entry.bookId, index);

    await this.touchBook(entry.bookId);
    return entry;
  }

  async updateEntry(
    id: string,
    patch: Partial<
      Pick<
        DiaryEntry,
        "title" | "date" | "contentHtml" | "plainText" | "tags" | "mood"
      >
    >,
  ): Promise<DiaryEntry | undefined> {
    await this.ensureInitialized();
    const existing = await this.getEntry(id);
    if (!existing) return undefined;

    const next: DiaryEntry = {
      ...existing,
      ...patch,
      updatedAt: Date.now(),
      version: existing.version + 1,
    };

    const entryPath = await join(this.userDir, "entries", next.bookId, `${next.id}.json`);
    await this.atomicWriteJson(entryPath, next);

    // Update book index
    const index = await this.loadBookIndex(next.bookId);
    const idx = index.findIndex((i) => i.id === next.id);
    const wordCount = next.plainText ? next.plainText.trim().split(/\s+/).filter(Boolean).length : 0;
    const indexRecord: EntryIndexRecord = {
      id: next.id,
      bookId: next.bookId,
      ownerId: next.ownerId,
      title: next.title,
      date: next.date,
      wordCount,
      tags: next.tags,
      mood: next.mood,
      createdAt: next.createdAt,
      updatedAt: next.updatedAt,
      version: next.version,
      deletedAt: next.deletedAt,
    };

    if (idx >= 0) {
      index[idx] = indexRecord;
    } else {
      index.push(indexRecord);
    }
    await this.saveBookIndex(next.bookId, index);

    await this.touchBook(next.bookId);
    return next;
  }

  async softDeleteEntry(id: string): Promise<void> {
    await this.ensureInitialized();
    const existing = await this.getEntry(id);
    if (!existing) return;

    const next: DiaryEntry = {
      ...existing,
      deletedAt: Date.now(),
      updatedAt: Date.now(),
      version: existing.version + 1,
    };

    const entryPath = await join(this.userDir, "entries", next.bookId, `${next.id}.json`);
    await this.atomicWriteJson(entryPath, next);

    const index = await this.loadBookIndex(next.bookId);
    const idx = index.findIndex((i) => i.id === next.id);
    if (idx >= 0) {
      index[idx].deletedAt = next.deletedAt;
      index[idx].updatedAt = next.updatedAt;
      await this.saveBookIndex(next.bookId, index);
    }

    await this.touchBook(next.bookId);
  }

  async purgeOldDeleted(): Promise<void> {
    await this.ensureInitialized();
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const books = await this.listBooks();

    for (const book of books) {
      const index = await this.loadBookIndex(book.id);
      const remaining: EntryIndexRecord[] = [];

      for (const record of index) {
        if (record.deletedAt && record.deletedAt < cutoff) {
          const entryPath = await join(this.userDir, "entries", book.id, `${record.id}.json`);
          if (await exists(entryPath)) {
            await remove(entryPath);
          }
        } else {
          remaining.push(record);
        }
      }
      await this.saveBookIndex(book.id, remaining);
    }
  }

  // -------------------------------------------------- Lifecycle & Portability
  async deleteAllData(): Promise<void> {
    await this.ensureInitialized();
    const booksPath = await join(this.userDir, "books.json");
    await this.atomicWriteJson(booksPath, []);

    const entriesDir = await join(this.userDir, "entries");
    if (await exists(entriesDir)) {
      await remove(entriesDir, { recursive: true });
      await mkdir(entriesDir, { recursive: true });
    }

    const backupsDir = await join(this.userDir, "backups");
    if (await exists(backupsDir)) {
      await remove(backupsDir, { recursive: true });
      await mkdir(backupsDir, { recursive: true });
    }
  }

  async exportAll(): Promise<DiaryBackup> {
    await this.ensureInitialized();
    const [books, entries] = await Promise.all([
      this.listBooks(),
      this.listAllEntries(),
    ]);

    const exportedAt = Date.now();
    const encryptedOwner = await encryptOwnerId(this.currentOwnerId);
    const ownerToken = await signBackupManifest(this.currentOwnerId, exportedAt);

    const safeBooks = books.map((b) => ({ ...b, ownerId: encryptedOwner }));
    const safeEntries = entries.map((e) => ({ ...e, ownerId: encryptedOwner }));

    return {
      app: "local-diary-core",
      schemaVersion: SCHEMA_VERSION,
      exportedAt,
      ownerToken,
      books: safeBooks,
      entries: safeEntries,
    };
  }

  async importBackup(
    backup: DiaryBackup,
    opts: { overwrite: boolean },
  ): Promise<{ books: number; entries: number; skipped: number }> {
    await this.ensureInitialized();
    if (
      !backup ||
      (backup.app !== "local-diary-core" && backup.app !== "my-diary") ||
      !Array.isArray(backup.books)
    ) {
      throw new Error("This file is not a valid Local Diary Core backup.");
    }

    let booksCount = 0;
    let entriesCount = 0;
    let skipped = 0;

    for (const raw of backup.books) {
      const book = sanitizeBook(raw, this.currentOwnerId);
      if (!book) {
        skipped++;
        continue;
      }
      const existing = await this.getBook(book.id);
      if (existing && !opts.overwrite) {
        skipped++;
        continue;
      }
      await this.updateBook(book.id, book);
      booksCount++;
    }

    for (const raw of backup.entries) {
      const entry = sanitizeEntry(raw, this.currentOwnerId);
      if (!entry) {
        skipped++;
        continue;
      }
      const existing = await this.getEntry(entry.id);
      if (existing && !opts.overwrite) {
        skipped++;
        continue;
      }
      await this.createEntry(entry);
      entriesCount++;
    }

    return { books: booksCount, entries: entriesCount, skipped };
  }

  // --------------------------------------------------- Internal Vault Backups
  async listInternalBackups(): Promise<StoredBackupRecord[]> {
    await this.ensureInitialized();
    const backupsDir = await join(this.userDir, "backups");
    if (!(await exists(backupsDir))) return [];

    const entries = await readDir(backupsDir);
    const backups: StoredBackupRecord[] = [];

    for (const entry of entries) {
      if (entry.name && entry.name.endsWith(".json")) {
        const filePath = await join(backupsDir, entry.name);
        const record = await this.readJsonFile<StoredBackupRecord | null>(filePath, null);
        if (record) {
          backups.push(record);
        }
      }
    }
    return backups.sort((a, b) => b.exportedAt - a.exportedAt);
  }

  async saveInternalBackup(record: StoredBackupRecord): Promise<void> {
    await this.ensureInitialized();
    const backupsDir = await join(this.userDir, "backups");
    await mkdir(backupsDir, { recursive: true });
    const backupPath = await join(backupsDir, `${record.id}.json`);
    await this.atomicWriteJson(backupPath, record);
  }

  async deleteInternalBackup(id: string): Promise<void> {
    await this.ensureInitialized();
    const backupPath = await join(this.userDir, "backups", `${id}.json`);
    if (await exists(backupPath)) {
      await remove(backupPath);
    }
  }

  // ------------------------------------------------------- Storage Management
  async getStorageInfo(): Promise<StorageInfo> {
    await this.ensureInitialized();
    const platform = detectPlatform();
    const isWindows = platform === "windows";
    const isAndroid = platform === "android";

    return {
      type: isAndroid ? "native-android" : "native-windows",
      status: "device",
      path: this.rootDir,
      displayPath: this.rootDir,
      isNative: true,
      canOpenFolder: isWindows,
      canChangeLocation: isWindows,
      canExport: true,
      canBackup: true,
      canRestore: true,
      details: "Your diary is stored locally on this device.",
    };
  }

  async openStorageFolder(): Promise<void> {
    await this.ensureInitialized();
    await openPath(this.rootDir);
  }

  async changeStorageLocation(newPath: string): Promise<void> {
    await this.ensureInitialized();
    const trimmed = newPath.trim();
    if (!trimmed || trimmed === this.rootDir) return;

    // 1. Ensure target directory exists
    await mkdir(trimmed, { recursive: true });

    // 2. Export existing data snapshot
    const [books, allEntries, backups] = await Promise.all([
      this.listBooks(),
      this.listAllEntries(),
      this.listInternalBackups(),
    ]);

    // 3. Recreate user directory at new location
    const newTargetUserDir = await join(trimmed, "users", this.ownerKey);
    await mkdir(newTargetUserDir, { recursive: true });
    await mkdir(await join(newTargetUserDir, "entries"), { recursive: true });
    await mkdir(await join(newTargetUserDir, "backups"), { recursive: true });

    // 4. Copy books
    await this.atomicWriteJson(await join(newTargetUserDir, "books.json"), books);

    // 5. Copy entries
    for (const book of books) {
      const bookEntriesDir = await join(newTargetUserDir, "entries", book.id);
      await mkdir(bookEntriesDir, { recursive: true });
      const bookEntries = allEntries.filter((e) => e.bookId === book.id);
      const indexRecords: EntryIndexRecord[] = [];

      for (const entry of bookEntries) {
        await this.atomicWriteJson(await join(bookEntriesDir, `${entry.id}.json`), entry);
        const wordCount = entry.plainText ? entry.plainText.trim().split(/\s+/).filter(Boolean).length : 0;
        indexRecords.push({
          id: entry.id,
          bookId: entry.bookId,
          ownerId: entry.ownerId,
          title: entry.title,
          date: entry.date,
          wordCount,
          tags: entry.tags,
          mood: entry.mood,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          version: entry.version,
          deletedAt: entry.deletedAt,
        });
      }
      await this.atomicWriteJson(await join(bookEntriesDir, "index.json"), indexRecords);
    }

    // 6. Copy backups
    for (const backup of backups) {
      await this.atomicWriteJson(await join(newTargetUserDir, "backups", `${backup.id}.json`), backup);
    }

    // 6b. Copy local preferences / App Lock / API key
    const currentSettings = await this.getSettings();
    if (currentSettings) {
      await this.atomicWriteJson(await join(newTargetUserDir, "settings.json"), currentSettings);
    }

    // 7. Verify new location
    const verifiedBooks = await this.readJsonFile<DiaryBookMeta[]>(
      await join(newTargetUserDir, "books.json"),
      [],
    );
    if (verifiedBooks.length !== books.length) {
      throw new Error("Validation failed while copying diary books to new destination.");
    }

    // 8. Update active root & persist custom path
    this.rootDir = trimmed;
    this.userDir = newTargetUserDir;
    if (typeof window !== "undefined") {
      localStorage.setItem(CUSTOM_PATH_KEY, trimmed);
    }
  }

  // ------------------------------------------------------------- Local Settings
  async getSettings(): Promise<Partial<DiaryPrefs> | null> {
    await this.ensureInitialized();
    const settingsPath = await join(this.userDir, "settings.json");
    return this.readJsonFile<Partial<DiaryPrefs> | null>(settingsPath, null);
  }

  async saveSettings(settings: Partial<DiaryPrefs>): Promise<void> {
    await this.ensureInitialized();
    const settingsPath = await join(this.userDir, "settings.json");
    await this.atomicWriteJson(settingsPath, settings);
  }

  // ------------------------------------------------------------- Helpers
  private async atomicWriteJson(filePath: string, data: unknown): Promise<void> {
    const tmpPath = `${filePath}.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const content = JSON.stringify(data, null, 2);
    await writeTextFile(tmpPath, content);
    await rename(tmpPath, filePath);
  }

  private async readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
    try {
      if (!(await exists(filePath))) return fallback;
      const text = await readTextFile(filePath);
      return JSON.parse(text) as T;
    } catch {
      return fallback;
    }
  }

  private async saveBooks(books: DiaryBookMeta[]): Promise<void> {
    const booksPath = await join(this.userDir, "books.json");
    await this.atomicWriteJson(booksPath, books);
  }

  private async loadBookIndex(bookId: string): Promise<EntryIndexRecord[]> {
    const indexPath = await join(this.userDir, "entries", bookId, "index.json");
    const index = await this.readJsonFile<EntryIndexRecord[] | null>(indexPath, null);
    if (Array.isArray(index)) return index;

    // If index.json missing or corrupted, rebuild index by scanning entry files
    return this.rebuildBookIndex(bookId);
  }

  private async saveBookIndex(bookId: string, index: EntryIndexRecord[]): Promise<void> {
    const indexPath = await join(this.userDir, "entries", bookId, "index.json");
    await this.atomicWriteJson(indexPath, index);
  }

  private async rebuildBookIndex(bookId: string): Promise<EntryIndexRecord[]> {
    const bookEntriesDir = await join(this.userDir, "entries", bookId);
    if (!(await exists(bookEntriesDir))) return [];

    const files = await readDir(bookEntriesDir);
    const index: EntryIndexRecord[] = [];

    for (const f of files) {
      if (f.name && f.name.endsWith(".json") && f.name !== "index.json") {
        const entryPath = await join(bookEntriesDir, f.name);
        const entry = await this.readJsonFile<DiaryEntry | null>(entryPath, null);
        if (entry) {
          const wordCount = entry.plainText ? entry.plainText.trim().split(/\s+/).filter(Boolean).length : 0;
          index.push({
            id: entry.id,
            bookId: entry.bookId,
            ownerId: entry.ownerId,
            title: entry.title,
            date: entry.date,
            wordCount,
            tags: entry.tags || [],
            mood: entry.mood || "",
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            version: entry.version || 1,
            deletedAt: entry.deletedAt || null,
          });
        }
      }
    }
    await this.saveBookIndex(bookId, index);
    return index;
  }

  private async loadAllBookEntries(bookId: string): Promise<DiaryEntry[]> {
    const index = await this.loadBookIndex(bookId);
    const entries: DiaryEntry[] = [];
    const bookEntriesDir = await join(this.userDir, "entries", bookId);

    for (const record of index) {
      const entryPath = await join(bookEntriesDir, `${record.id}.json`);
      const entry = await this.readJsonFile<DiaryEntry | null>(entryPath, null);
      if (entry) {
        entries.push(entry);
      }
    }
    return entries;
  }

  private async touchBook(bookId: string): Promise<void> {
    const books = await this.listBooks();
    const idx = books.findIndex((b) => b.id === bookId);
    if (idx >= 0) {
      books[idx].updatedAt = Date.now();
      await this.saveBooks(books);
    }
  }
}

// ------------------------------------------------------------- Sanitizers
function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sanitizeBook(raw: unknown, targetOwnerId = "local"): DiaryBookMeta | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const title = str(r.title).trim();
  if (!title) return null;
  return {
    id: str(r.id) || `bk_${Date.now().toString(36)}${crypto.randomUUID().slice(0, 8)}`,
    ownerId: targetOwnerId || "local",
    title,
    subtitle: str(r.subtitle),
    author: str(r.author),
    coverStyle: isCoverStyle(r.coverStyle) ? r.coverStyle : "ink",
    coverImage: str(r.coverImage) || null,
    pageStyle: isPageStyle(r.pageStyle) ? r.pageStyle : "lined",
    pageImage: str(r.pageImage) || null,
    schemaVersion: SCHEMA_VERSION,
    createdAt: num(r.createdAt, Date.now()),
    updatedAt: num(r.updatedAt, Date.now()),
  };
}

function sanitizeEntry(raw: unknown, targetOwnerId = "local"): DiaryEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const contentHtml = str(r.contentHtml);
  const plainText = str(r.plainText) || htmlToPlainText(contentHtml);
  const bookId = str(r.bookId);
  if (!bookId) return null;
  const date = str(r.date) || new Date().toISOString().slice(0, 10);
  return {
    id: str(r.id) || `en_${Date.now().toString(36)}${crypto.randomUUID().slice(0, 8)}`,
    bookId,
    ownerId: targetOwnerId || "local",
    title: str(r.title) || "Untitled",
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10),
    contentHtml,
    plainText,
    tags: Array.isArray(r.tags)
      ? r.tags.filter((t): t is string => typeof t === "string").slice(0, 12)
      : [],
    mood: str(r.mood),
    createdAt: num(r.createdAt, Date.now()),
    updatedAt: num(r.updatedAt, Date.now()),
    version: num(r.version, 1),
    deletedAt: typeof r.deletedAt === "number" ? r.deletedAt : null,
  };
}

function htmlToPlainText(html: string): string {
  if (typeof window === "undefined") {
    return html.replace(/<[^>]*>/g, " ");
  }
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || "").replace(/\s+/g, " ").trim();
}

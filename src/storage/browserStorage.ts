/**
 * Platform Storage Abstraction — Browser / PWA Storage Implementation.
 *
 * Implements StorageProvider using Dexie (IndexedDB) for browser environments,
 * mobile PWAs, and systems where native OS filesystem access is unavailable.
 */
import Dexie, { type Table } from "dexie";
import type { DiaryBackup, DiaryBookMeta, DiaryEntry, DiaryPrefs } from "@/diary/types";
import {
  isCoverStyle,
  isPageStyle,
  SCHEMA_VERSION,
} from "@/diary/types";
import { encryptOwnerId, signBackupManifest } from "@/diary/backupCrypto";
import {
  backupVaultDb,
  hashUserId,
  type StoredBackupRecord,
} from "@/diary/backupVault";
import type { StorageProvider } from "./StorageProvider";
import type { StorageInfo } from "./types";

function dbName(ownerId: string): string {
  const safe = ownerId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "local";
  return `my-diary-${safe}`;
}

class BrowserDiaryDatabase extends Dexie {
  books!: Table<DiaryBookMeta, string>;
  entries!: Table<DiaryEntry, string>;

  constructor(ownerId: string) {
    super(dbName(ownerId), {
      indexedDB: typeof indexedDB !== "undefined" ? indexedDB : undefined,
      IDBKeyRange: typeof IDBKeyRange !== "undefined" ? IDBKeyRange : undefined,
    });
    this.version(1).stores({
      books: "id, ownerId, updatedAt",
      entries: "id, bookId, [bookId+date], [bookId+updatedAt], updatedAt, deletedAt",
    });
  }
}

export class BrowserStorageProvider implements StorageProvider {
  readonly currentOwnerId: string;
  private db: BrowserDiaryDatabase;

  constructor(ownerId: string) {
    this.currentOwnerId = ownerId;
    this.db = new BrowserDiaryDatabase(ownerId);
  }

  // ------------------------------------------------------------------ Books
  async listBooks(): Promise<DiaryBookMeta[]> {
    return this.db.books.orderBy("updatedAt").reverse().toArray();
  }

  async getBook(id: string): Promise<DiaryBookMeta | undefined> {
    return this.db.books.get(id);
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
    await this.db.books.add(book);
    return book;
  }

  async updateBook(
    id: string,
    patch: Partial<Omit<DiaryBookMeta, "id" | "ownerId" | "schemaVersion">>,
  ): Promise<void> {
    await this.db.books.update(id, { ...patch, updatedAt: Date.now() });
  }

  async deleteBook(id: string): Promise<void> {
    await this.db.transaction("rw", this.db.books, this.db.entries, async () => {
      await this.db.entries.where("bookId").equals(id).delete();
      await this.db.books.delete(id);
    });
  }

  // ---------------------------------------------------------------- Entries
  async listEntries(bookId: string): Promise<DiaryEntry[]> {
    const rows = await this.db.entries.where("bookId").equals(bookId).toArray();
    return rows
      .filter((e) => !e.deletedAt)
      .sort((a, b) =>
        a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1,
      );
  }

  async getEntry(id: string): Promise<DiaryEntry | undefined> {
    return this.db.entries.get(id);
  }

  async listAllEntries(): Promise<DiaryEntry[]> {
    const rows = await this.db.entries.toArray();
    return rows
      .filter((e) => !e.deletedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async entryStats(): Promise<Map<string, { entries: number; words: number }>> {
    const rows = await this.db.entries.toArray();
    const map = new Map<string, { entries: number; words: number }>();
    for (const e of rows) {
      if (e.deletedAt) continue;
      const cur = map.get(e.bookId) ?? { entries: 0, words: 0 };
      cur.entries += 1;
      cur.words += e.plainText
        ? e.plainText.trim().split(/\s+/).filter(Boolean).length
        : 0;
      map.set(e.bookId, cur);
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
    const now = Date.now();
    const entry: DiaryEntry = {
      id: `en_${now.toString(36)}${crypto.randomUUID().slice(0, 8)}`,
      ...input,
      createdAt: now,
      updatedAt: now,
      version: 1,
      deletedAt: null,
    };
    await this.db.entries.add(entry);
    await this.touchBook(input.bookId);
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
    const existing = await this.db.entries.get(id);
    if (!existing) return undefined;
    const next: DiaryEntry = {
      ...existing,
      ...patch,
      updatedAt: Date.now(),
      version: existing.version + 1,
    };
    await this.db.entries.put(next);
    await this.touchBook(existing.bookId);
    return next;
  }

  async softDeleteEntry(id: string): Promise<void> {
    const existing = await this.db.entries.get(id);
    if (!existing) return;
    await this.db.entries.put({
      ...existing,
      deletedAt: Date.now(),
      updatedAt: Date.now(),
      version: existing.version + 1,
    });
    await this.touchBook(existing.bookId);
  }

  async purgeOldDeleted(): Promise<void> {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const stale = await this.db.entries
      .filter((e) => e.deletedAt !== null)
      .toArray();
    const ids = stale
      .filter((e) => typeof e.deletedAt === "number" && e.deletedAt < cutoff)
      .map((e) => e.id);
    await this.db.entries.bulkDelete(ids);
  }

  // -------------------------------------------------- Lifecycle & Portability
  async deleteAllData(): Promise<void> {
    await this.db.transaction("rw", this.db.books, this.db.entries, async () => {
      await this.db.entries.clear();
      await this.db.books.clear();
    });
  }

  async exportAll(): Promise<DiaryBackup> {
    const [books, entries] = await Promise.all([
      this.db.books.toArray(),
      this.db.entries.toArray(),
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
    if (
      !backup ||
      (backup.app !== "local-diary-core" && backup.app !== "my-diary") ||
      !Array.isArray(backup.books)
    ) {
      throw new Error("This file is not a valid Local Diary Core backup.");
    }
    let books = 0;
    let entries = 0;
    let skipped = 0;
    await this.db.transaction("rw", this.db.books, this.db.entries, async () => {
      for (const raw of backup.books) {
        const book = sanitizeBook(raw, this.currentOwnerId);
        if (!book) {
          skipped++;
          continue;
        }
        const exists = await this.db.books.get(book.id);
        if (exists && !opts.overwrite) {
          skipped++;
          continue;
        }
        await this.db.books.put(book);
        books++;
      }
      for (const raw of backup.entries) {
        const entry = sanitizeEntry(raw, this.currentOwnerId);
        if (!entry) {
          skipped++;
          continue;
        }
        const exists = await this.db.entries.get(entry.id);
        if (exists && !opts.overwrite) {
          skipped++;
          continue;
        }
        await this.db.entries.put(entry);
        entries++;
        if (exists) {
          await this.touchBook(entry.bookId);
        }
      }
    });
    return { books, entries, skipped };
  }

  // --------------------------------------------------- Internal Vault Backups
  async listInternalBackups(): Promise<StoredBackupRecord[]> {
    const ownerHash = await hashUserId(this.currentOwnerId);
    return backupVaultDb.backups
      .where("ownerIdHash")
      .equals(ownerHash)
      .reverse()
      .sortBy("exportedAt");
  }

  async saveInternalBackup(record: StoredBackupRecord): Promise<void> {
    await backupVaultDb.backups.put(record);
  }

  async deleteInternalBackup(id: string): Promise<void> {
    await backupVaultDb.backups.delete(id);
  }

  // ------------------------------------------------------- Storage Management
  async getStorageInfo(): Promise<StorageInfo> {
    return {
      type: "browser-indexeddb",
      status: "browser",
      path: "IndexedDB / Dexie",
      displayPath: "Browser Storage (IndexedDB)",
      isNative: false,
      canOpenFolder: false,
      canChangeLocation: false,
      canExport: true,
      canBackup: true,
      canRestore: true,
      details: "Your diary is stored in browser-managed storage.",
    };
  }

  // ------------------------------------------------------------- Local Settings
  async getSettings(): Promise<Partial<DiaryPrefs> | null> {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem("my-diary-prefs") : null;
      return raw ? (JSON.parse(raw) as Partial<DiaryPrefs>) : null;
    } catch {
      return null;
    }
  }

  async saveSettings(settings: Partial<DiaryPrefs>): Promise<void> {
    try {
      if (typeof window === "undefined") return;
      const current = (await this.getSettings()) || {};
      localStorage.setItem("my-diary-prefs", JSON.stringify({ ...current, ...settings }));
    } catch {
      // Storage full or private mode
    }
  }

  private async touchBook(bookId: string): Promise<void> {
    await this.db.books.update(bookId, { updatedAt: Date.now() });
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

export function htmlToPlainText(html: string): string {
  if (typeof window === "undefined") {
    return html.replace(/<[^>]*>/g, " ");
  }
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || "").replace(/\s+/g, " ").trim();
}

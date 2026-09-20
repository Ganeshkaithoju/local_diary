/**
 * Platform Storage Abstraction — Unified StorageProvider Interface.
 *
 * All diary domain operations and backup management go through this interface.
 * UI components interact strictly with StorageProvider, never coupling directly
 * to IndexedDB or filesystem APIs.
 */
import type { DiaryBackup, DiaryBookMeta, DiaryEntry, DiaryPrefs } from "@/diary/types";
import type { StoredBackupRecord } from "@/diary/backupVault";
import type { StorageInfo } from "./types";

export interface StorageProvider {
  /** The authentic account identifier currently bound to this storage session */
  readonly currentOwnerId: string;

  // ------------------------------------------------------------------ Books
  listBooks(): Promise<DiaryBookMeta[]>;
  getBook(id: string): Promise<DiaryBookMeta | undefined>;
  createBook(
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
  ): Promise<DiaryBookMeta>;
  updateBook(
    id: string,
    patch: Partial<Omit<DiaryBookMeta, "id" | "ownerId" | "schemaVersion">>,
  ): Promise<void>;
  deleteBook(id: string): Promise<void>;

  // ---------------------------------------------------------------- Entries
  listEntries(bookId: string): Promise<DiaryEntry[]>;
  getEntry(id: string): Promise<DiaryEntry | undefined>;
  listAllEntries(): Promise<DiaryEntry[]>;
  entryStats(): Promise<Map<string, { entries: number; words: number }>>;
  createEntry(
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
  ): Promise<DiaryEntry>;
  updateEntry(
    id: string,
    patch: Partial<
      Pick<
        DiaryEntry,
        "title" | "date" | "contentHtml" | "plainText" | "tags" | "mood"
      >
    >,
  ): Promise<DiaryEntry | undefined>;
  softDeleteEntry(id: string): Promise<void>;
  purgeOldDeleted(): Promise<void>;

  // -------------------------------------------------- Lifecycle & Portability
  deleteAllData(): Promise<void>;
  exportAll(): Promise<DiaryBackup>;
  importBackup(
    backup: DiaryBackup,
    opts: { overwrite: boolean },
  ): Promise<{ books: number; entries: number; skipped: number }>;

  // --------------------------------------------------- Internal Vault Backups
  listInternalBackups(): Promise<StoredBackupRecord[]>;
  saveInternalBackup(record: StoredBackupRecord): Promise<void>;
  deleteInternalBackup(id: string): Promise<void>;

  // ------------------------------------------------------- Storage Management
  getStorageInfo(): Promise<StorageInfo>;
  openStorageFolder?(): Promise<void>;
  changeStorageLocation?(newPath: string): Promise<void>;

  // ------------------------------------------------------------- Local Settings
  getSettings?(): Promise<Partial<DiaryPrefs> | null>;
  saveSettings?(settings: Partial<DiaryPrefs>): Promise<void>;
}

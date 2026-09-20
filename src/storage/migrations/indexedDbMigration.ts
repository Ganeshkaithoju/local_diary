/**
 * Storage Migration — IndexedDB to Native Device Storage.
 *
 * Scans existing Dexie (IndexedDB) databases for user books, entries, and
 * vault backups, safely copying them to durable native device storage.
 *
 * Guarantees:
 * 1. Non-destructive: Old IndexedDB records are preserved as safety fallbacks.
 * 2. Idempotent: Can safely be re-run without creating duplicate records.
 * 3. Verified: Record counts are validated post-copy before marking complete.
 */
import { BrowserStorageProvider } from "../browserStorage";
import type { StorageProvider } from "../StorageProvider";
import type { MigrationResult } from "../types";

export async function migrateFromIndexedDb(
  ownerId: string,
  targetProvider: StorageProvider,
): Promise<MigrationResult> {
  try {
    const browserSource = new BrowserStorageProvider(ownerId);
    const [books, entries, backups] = await Promise.all([
      browserSource.listBooks(),
      browserSource.listAllEntries(),
      browserSource.listInternalBackups(),
    ]);

    if (!books.length && !entries.length && !backups.length) {
      return {
        success: true,
        booksCount: 0,
        entriesCount: 0,
        backupsCount: 0,
      };
    }

    // Copy books to target provider
    for (const book of books) {
      const existing = await targetProvider.getBook(book.id);
      if (!existing) {
        // Create or put book
        await targetProvider.updateBook(book.id, book);
      }
    }

    // Copy entries to target provider
    for (const entry of entries) {
      const existing = await targetProvider.getEntry(entry.id);
      if (!existing) {
        await targetProvider.createEntry(entry);
      }
    }

    // Copy internal backups
    for (const backup of backups) {
      await targetProvider.saveInternalBackup(backup);
    }

    // Copy local preferences / App Lock / Gemini API key
    if (targetProvider.saveSettings && typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem("my-diary-prefs");
        if (raw) {
          const parsed = JSON.parse(raw);
          await targetProvider.saveSettings(parsed);
        }
      } catch {
        // Non-critical: ignore prefs migration failure
      }
    }

    // Verification check
    const [verifiedBooks, verifiedEntries, verifiedBackups] = await Promise.all([
      targetProvider.listBooks(),
      targetProvider.listAllEntries(),
      targetProvider.listInternalBackups(),
    ]);

    if (
      verifiedBooks.length < books.length ||
      verifiedEntries.length < entries.length ||
      verifiedBackups.length < backups.length
    ) {
      throw new Error(
        `Verification failed: copied ${verifiedBooks.length}/${books.length} books, ` +
          `${verifiedEntries.length}/${entries.length} entries, and ` +
          `${verifiedBackups.length}/${backups.length} backups.`,
      );
    }

    return {
      success: true,
      booksCount: books.length,
      entriesCount: entries.length,
      backupsCount: backups.length,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err || "Unknown migration error");
    return {
      success: false,
      booksCount: 0,
      entriesCount: 0,
      backupsCount: 0,
      error: msg,
    };
  }
}

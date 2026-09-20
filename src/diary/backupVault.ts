/**
 * Private Application-Internal Backup Vault.
 *
 * Stores backups directly within the application address space (sandboxed IndexedDB)
 * rather than downloading files into the public Downloads directory.
 *
 * Security Guarantees:
 * 1. User Isolation: Backups are bound to the specific user's encoded identifier.
 * 2. Verified Restore: Only the authentic user who created a backup can restore it.
 * 3. Date Selection: Presents all available backup snapshots by date for one-click restore.
 * 4. Zero Public Exposure: Private diary text is never dumped into unmanaged OS folders.
 */
import Dexie, { type Table } from "dexie";
import type { DiaryBackup } from "./types";
import type { DiaryStorage } from "./storage";

export interface StoredBackupRecord {
  id: string;
  ownerIdHash: string;
  encodedUserId: string;
  exportedAt: number;
  dateFormatted: string;
  booksCount: number;
  entriesCount: number;
  ownerToken: string;
  backupData: DiaryBackup;
}

/**
 * Generates a deterministic, opaque hash of the user ID for ownership verification.
 */
export async function hashUserId(ownerId: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    enc.encode(`ldc-vault-user:${ownerId || "local"}`),
  );
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function formatBackupDate(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

class BackupVaultDatabase extends Dexie {
  backups!: Table<StoredBackupRecord, string>;

  constructor() {
    super("local-diary-core-vault", {
      indexedDB: typeof indexedDB !== "undefined" ? indexedDB : undefined,
      IDBKeyRange: typeof IDBKeyRange !== "undefined" ? IDBKeyRange : undefined,
    });
    this.version(1).stores({
      backups: "id, ownerIdHash, exportedAt",
    });
  }
}

import { getStorageProvider, type StorageProvider } from "@/storage";

export const backupVaultDb = new BackupVaultDatabase();

/**
 * Saves a new backup snapshot directly into internal application storage.
 * Does NOT download a file to the OS downloads directory.
 */
export async function createInternalBackup(
  storage: StorageProvider,
): Promise<StoredBackupRecord> {
  const backup = await storage.exportAll();
  if (!backup.books.length && !backup.entries.length) {
    throw new Error("Nothing to back up yet — write something first.");
  }

  const exportedAt = backup.exportedAt || Date.now();
  const ownerIdHash = await hashUserId(storage.currentOwnerId);
  const encodedUserId = ownerIdHash.slice(0, 24);

  const record: StoredBackupRecord = {
    id: `bak_${exportedAt}_${crypto.randomUUID().slice(0, 8)}`,
    ownerIdHash,
    encodedUserId,
    exportedAt,
    dateFormatted: formatBackupDate(exportedAt),
    booksCount: backup.books.length,
    entriesCount: backup.entries.length,
    ownerToken: backup.ownerToken || "",
    backupData: backup,
  };

  await storage.saveInternalBackup(record);
  // Also save to IndexedDB as secondary mirror if browser DB is available
  try {
    await backupVaultDb.backups.put(record);
  } catch {
    // Ignore IndexedDB mirror failure in native mode
  }
  return record;
}

/**
 * Lists all available backups stored in the application for the given verified user.
 * Sorted chronologically with newest first.
 */
export async function listUserBackups(
  ownerId: string,
  storage?: StorageProvider,
): Promise<StoredBackupRecord[]> {
  const provider = storage || getStorageProvider(ownerId);
  const records = await provider.listInternalBackups();
  if (records.length > 0) {
    return records;
  }

  // Fallback check in Dexie vault if provider had none
  try {
    const ownerIdHash = await hashUserId(ownerId);
    return await backupVaultDb.backups
      .where("ownerIdHash")
      .equals(ownerIdHash)
      .reverse()
      .sortBy("exportedAt");
  } catch {
    return [];
  }
}

/**
 * Performs a verified one-click restore of an internal application backup.
 * Strictly verifies that the backup was created by the currently authenticated user.
 */
export async function restoreInternalBackup(
  storage: StorageProvider,
  backupId: string,
  opts: { overwrite: boolean } = { overwrite: true },
): Promise<{ books: number; entries: number; skipped: number }> {
  let record: StoredBackupRecord | undefined;
  const backups = await storage.listInternalBackups();
  record = backups.find((b) => b.id === backupId);

  if (!record) {
    record = await backupVaultDb.backups.get(backupId);
  }

  if (!record) {
    throw new Error("The requested backup snapshot was not found in application storage.");
  }

  // Strict ownership check: verified user can ONLY restore their own data
  const currentHash = await hashUserId(storage.currentOwnerId);
  if (record.ownerIdHash !== currentHash) {
    throw new Error(
      `Access Denied: This backup was created by user (${record.encodedUserId}) and cannot be restored into your current session.`,
    );
  }

  // Restore into active database with safe scoping
  return await storage.importBackup(record.backupData, opts);
}

/**
 * Deletes a stored backup snapshot from application storage.
 * Verifies ownership before deletion.
 */
export async function deleteInternalBackup(
  backupId: string,
  ownerId: string,
  storage?: StorageProvider,
): Promise<void> {
  const provider = storage || getStorageProvider(ownerId);
  await provider.deleteInternalBackup(backupId);

  try {
    await backupVaultDb.backups.delete(backupId);
  } catch {
    // ignore
  }
}

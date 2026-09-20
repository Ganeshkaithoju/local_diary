/**
 * Platform Storage Abstraction — Type Definitions.
 *
 * Defines the unified storage contracts, storage states, manifest schemas,
 * and entry indexing metadata for both native filesystem and browser backends.
 */
import type { DiaryBookMeta, DiaryEntry, DiaryBackup } from "@/diary/types";
import type { StoredBackupRecord } from "@/diary/backupVault";

export type StorageType =
  | "native-windows"
  | "native-android"
  | "filesystem-api"
  | "browser-indexeddb";

export type StorageStatus =
  | "device"
  | "browser"
  | "migrating"
  | "completed"
  | "failed"
  | "unavailable"
  | "readonly";

export interface StorageInfo {
  type: StorageType;
  status: StorageStatus;
  path: string;
  displayPath: string;
  isNative: boolean;
  canOpenFolder: boolean;
  canChangeLocation: boolean;
  canExport: boolean;
  canBackup: boolean;
  canRestore: boolean;
  details?: string;
}

export interface StorageManifest {
  app: "local-diary-core";
  formatVersion: number;
  appVersion: string;
  createdAt: number;
  updatedAt: number;
  activeOwnerKey: string;
  owners: string[];
}

export interface OwnerManifest {
  schemaVersion: number;
  appVersion: string;
  ownerKey: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  booksCount: number;
  entriesCount: number;
  migratedFromIndexedDbAt?: number | null;
}

export interface EntryIndexRecord {
  id: string;
  bookId: string;
  ownerId: string;
  title: string;
  date: string;
  wordCount: number;
  tags: string[];
  mood: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  deletedAt: number | null;
}

export interface MigrationResult {
  success: boolean;
  booksCount: number;
  entriesCount: number;
  backupsCount: number;
  error?: string;
}

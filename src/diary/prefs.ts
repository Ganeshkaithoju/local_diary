/**
 * Lightweight preferences store backed by localStorage.
 *
 * IMPORTANT: localStorage holds only non-diary preferences (lock config,
 * UI prefs, the optional Gemini key). All diary CONTENT lives in IndexedDB
 * via the Dexie storage engine.
 */
import { useSyncExternalStore } from "react";
import type { DiaryPrefs } from "./types";

const KEY = "my-diary-prefs";

const DEFAULT_PREFS: DiaryPrefs = {
  appLockEnabled: false,
  appLockHash: null,
  appLockSalt: null,
  autoLockMinutes: 15,
  geminiApiKey: "",
  lastBookId: null,
  openInFullScreen: false,
  lastOwnerId: null,
};

let cached: DiaryPrefs | null = null;
const listeners = new Set<() => void>();

function read(): DiaryPrefs {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    cached = raw
      ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<DiaryPrefs>) }
      : { ...DEFAULT_PREFS };
  } catch {
    cached = { ...DEFAULT_PREFS };
  }
  return cached;
}

type PrefsSaveHandler = (prefs: DiaryPrefs) => Promise<void> | void;
let onSaveHandler: PrefsSaveHandler | null = null;

export function registerPrefsDiskSync(handler: PrefsSaveHandler): () => void {
  onSaveHandler = handler;
  return () => {
    if (onSaveHandler === handler) onSaveHandler = null;
  };
}

export function hydratePrefsFromDisk(diskSettings: Partial<DiaryPrefs>): void {
  const current = read();
  const merged: DiaryPrefs = {
    ...current,
    ...diskSettings,
  };
  if (diskSettings.appLockHash !== undefined) merged.appLockHash = diskSettings.appLockHash;
  if (diskSettings.appLockSalt !== undefined) merged.appLockSalt = diskSettings.appLockSalt;
  if (diskSettings.appLockEnabled !== undefined) merged.appLockEnabled = diskSettings.appLockEnabled;
  if (diskSettings.autoLockMinutes !== undefined) merged.autoLockMinutes = diskSettings.autoLockMinutes;
  if (diskSettings.geminiApiKey !== undefined) merged.geminiApiKey = diskSettings.geminiApiKey;
  if (diskSettings.openInFullScreen !== undefined) merged.openInFullScreen = diskSettings.openInFullScreen;
  if (diskSettings.lastBookId !== undefined) merged.lastBookId = diskSettings.lastBookId;
  if (diskSettings.lastOwnerId !== undefined) merged.lastOwnerId = diskSettings.lastOwnerId;

  cached = merged;
  try {
    localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    // storage full / private mode
  }
  listeners.forEach((l) => l());
}

function write(prefs: DiaryPrefs): void {
  cached = prefs;
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // storage full / private mode — keep in-memory value
  }
  listeners.forEach((l) => l());
  if (onSaveHandler) {
    try {
      void onSaveHandler(prefs);
    } catch {
      // ignore background save errors
    }
  }
}

export function getPrefs(): DiaryPrefs {
  return read();
}

export function updatePrefs(patch: Partial<DiaryPrefs>): void {
  write({ ...read(), ...patch });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook exposing the current prefs with re-render on change. */
export function usePrefs(): {
  prefs: DiaryPrefs;
  updatePrefs: (patch: Partial<DiaryPrefs>) => void;
} {
  const prefs = useSyncExternalStore(subscribe, read, read);
  return { prefs, updatePrefs };
}

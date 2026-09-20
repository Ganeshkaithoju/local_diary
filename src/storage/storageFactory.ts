/**
 * Platform Storage Abstraction — Storage Provider Factory.
 *
 * Chooses and instantiates the appropriate StorageProvider implementation:
 * - TauriStorageProvider: Native Windows desktop and Android app environments.
 * - BrowserStorageProvider: Browser environments, PWAs, and web fallbacks.
 */
import { isTauriApp } from "@/lib/platform";
import type { StorageProvider } from "./StorageProvider";
import { BrowserStorageProvider } from "./browserStorage";
import { TauriStorageProvider } from "./tauriStorage";

const instances = new Map<string, StorageProvider>();

export function getStorageProvider(ownerId: string): StorageProvider {
  const key = ownerId || "local";
  const existing = instances.get(key);
  if (existing) {
    return existing;
  }

  let provider: StorageProvider;
  if (isTauriApp()) {
    provider = new TauriStorageProvider(key);
  } else {
    provider = new BrowserStorageProvider(key);
  }

  instances.set(key, provider);
  return provider;
}

export function clearStorageInstances(): void {
  instances.clear();
}

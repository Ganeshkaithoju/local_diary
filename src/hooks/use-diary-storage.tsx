/**
 * React binding for the diary storage engine.
 *
 * The storage instance is scoped to the authenticated local user (the Convex
 * user id, or "local" for guests). This keeps the same domain logic working
 * for any account while all data stays on-device.
 */
import { createContext, useContext, useMemo } from "react";
import type { StorageProvider } from "@/storage";
import { getStorageProvider } from "@/storage";

const StorageContext = createContext<StorageProvider | null>(null);

export function DiaryStorageProvider({
  ownerId,
  children,
}: {
  ownerId: string;
  children: React.ReactNode;
}) {
  const storage = useMemo(() => getStorageProvider(ownerId), [ownerId]);
  return <StorageContext.Provider value={storage}>{children}</StorageContext.Provider>;
}

export function useDiaryStorage(): StorageProvider {
  const storage = useContext(StorageContext);
  if (!storage) {
    throw new Error("useDiaryStorage must be used inside DiaryStorageProvider");
  }
  return storage;
}

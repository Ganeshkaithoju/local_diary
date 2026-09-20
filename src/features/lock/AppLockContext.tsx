import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { usePrefs } from "@/diary/prefs";

interface AppLockContextType {
  isLocked: boolean;
  isUnlocked: boolean;
  unlock: () => void;
  lock: () => void;
}

const AppLockContext = createContext<AppLockContextType | null>(null);

export function AppLockProvider({ children }: { children: ReactNode }) {
  const { prefs } = usePrefs();
  // Unlocked state is strictly stored in memory for the active session.
  // It resets to false whenever the application is reopened or restarted.
  const [isUnlocked, setIsUnlocked] = useState(false);

  const isLocked = Boolean(prefs.appLockEnabled && !isUnlocked);

  const unlock = useCallback(() => {
    setIsUnlocked(true);
  }, []);

  const lock = useCallback(() => {
    setIsUnlocked(false);
  }, []);

  // Automatic lock upon inactivity while unlocked
  useEffect(() => {
    if (!prefs.appLockEnabled || !isUnlocked) return;

    let timer: ReturnType<typeof setTimeout>;
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => setIsUnlocked(false),
        Math.max(1, prefs.autoLockMinutes) * 60_000,
      );
    };

    resetTimer();
    window.addEventListener("pointerdown", resetTimer);
    window.addEventListener("keydown", resetTimer);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", resetTimer);
      window.removeEventListener("keydown", resetTimer);
    };
  }, [prefs.appLockEnabled, prefs.autoLockMinutes, isUnlocked]);

  return (
    <AppLockContext.Provider value={{ isLocked, isUnlocked, unlock, lock }}>
      {children}
    </AppLockContext.Provider>
  );
}

export function useAppLock() {
  const ctx = useContext(AppLockContext);
  if (!ctx) {
    throw new Error("useAppLock must be used within an AppLockProvider");
  }
  return ctx;
}

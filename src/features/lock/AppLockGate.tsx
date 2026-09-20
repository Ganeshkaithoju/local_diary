import type { ReactNode } from "react";
import { useAppLock } from "./AppLockContext";
import { LockScreen } from "./LockScreen";

/**
 * AppLockGate prevents protected child routes and components from mounting
 * or executing until local App Lock is verified.
 * Eliminates any initial content flash on startup.
 */
export function AppLockGate({ children }: { children: ReactNode }) {
  const { isLocked, unlock } = useAppLock();

  if (isLocked) {
    return <LockScreen onUnlock={unlock} />;
  }

  return <>{children}</>;
}

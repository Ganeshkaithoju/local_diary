import { useEffect, useCallback } from "react";
import { api } from "@/convex/_generated/api";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { usePrefs } from "@/diary/prefs";

export function hasStoredAuthToken(): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key &&
        (key.includes("convexAuth") ||
          key.includes("convex_auth") ||
          key.includes("__convexAuth"))
      ) {
        const val = localStorage.getItem(key);
        if (val && val !== "null" && val !== "undefined" && val.length > 0) {
          return true;
        }
      }
    }
  } catch {
    // ignore
  }
  return false;
}

export function useAuth() {
  const { isLoading: isAuthLoading, isAuthenticated: isConvexAuthenticated } =
    useConvexAuth();
  const user = useQuery(api.users.currentUser);
  const { signIn, signOut: convexSignOut } = useAuthActions();
  const { prefs, updatePrefs } = usePrefs();

  // Cache lastOwnerId in local preferences whenever authenticated user is resolved
  useEffect(() => {
    if (user?._id && prefs.lastOwnerId !== user._id) {
      updatePrefs({ lastOwnerId: user._id });
    }
  }, [user?._id, prefs.lastOwnerId, updatePrefs]);

  const hasLocalSession = Boolean(prefs.lastOwnerId || hasStoredAuthToken());
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

  // If a valid local session exists, do not block offline or initial loading
  const isAuthenticated =
    isConvexAuthenticated ||
    (!isOnline && hasLocalSession) ||
    (isAuthLoading && hasLocalSession);

  // Loading only blocks if there is no local session and convex auth is still resolving
  const isLoading = isAuthLoading && !hasLocalSession;

  const signOut = useCallback(async () => {
    updatePrefs({ lastOwnerId: null });
    try {
      await convexSignOut();
    } catch {
      // Offline fallback
    }
  }, [convexSignOut, updatePrefs]);

  return {
    isLoading,
    isAuthenticated,
    user,
    signIn,
    signOut,
  };
}

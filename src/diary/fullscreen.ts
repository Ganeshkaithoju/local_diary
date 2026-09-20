/**
 * Full screen helpers.
 *
 * The workspace can open itself in full screen after sign-in so the browser
 * toolbars/taskbar stay out of the way while writing and reading. This only
 * applies to browser tabs — an installed app already runs without chrome, so
 * we leave it alone there.
 */
import { useCallback, useEffect, useState } from "react";
import { getPrefs } from "./prefs";
import { isInstalledApp } from "@/pwa";

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
};
type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void>;
};

/** The browser exposes the Fullscreen API and hasn't blocked it. */
export function canUseFullScreen(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.documentElement as FullscreenElement;
  return Boolean(
    (document.fullscreenEnabled ?? true) &&
      (el.requestFullscreen || el.webkitRequestFullscreen),
  );
}

export function isFullScreenActive(): boolean {
  if (typeof document === "undefined") return false;
  const doc = document as FullscreenDocument;
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

/** Enter full screen. Resolves false when the browser refused (no user gesture). */
export async function enterFullScreen(): Promise<boolean> {
  if (typeof document === "undefined") return false;
  if (isFullScreenActive()) return true;
  const el = document.documentElement as FullscreenElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else return false;
    return true;
  } catch {
    return false;
  }
}

export async function exitFullScreen(): Promise<void> {
  if (typeof document === "undefined") return;
  if (!isFullScreenActive()) return;
  const doc = document as FullscreenDocument;
  try {
    if (doc.exitFullscreen) await doc.exitFullscreen();
    else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
  } catch {
    // Browser dismissed it already — nothing to do.
  }
}

/** Toggle full screen; returns the state we ended up in. */
export async function toggleFullScreen(): Promise<boolean> {
  if (isFullScreenActive()) {
    await exitFullScreen();
    return false;
  }
  return enterFullScreen();
}

/**
 * Best-effort full screen request from inside a click handler. Must be called
 * synchronously (before any `await`) while the click still grants the browser
 * a user gesture — which is exactly how signing in works.
 */
export function requestFullScreenOnSignIn(): void {
  if (!getPrefs().openInFullScreen) return;
  if (isInstalledApp() || !canUseFullScreen() || isFullScreenActive()) return;
  void enterFullScreen();
}

/** Reactive full screen state for UI toggles. */
export function useFullScreen(): {
  active: boolean;
  supported: boolean;
  installed: boolean;
  toggle: () => Promise<void>;
} {
  const [active, setActive] = useState(isFullScreenActive);
  const [installed] = useState(isInstalledApp);

  useEffect(() => {
    const sync = () => setActive(isFullScreenActive());
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  const toggle = useCallback(async () => {
    setActive(await toggleFullScreen());
  }, []);

  return { active, supported: canUseFullScreen(), installed, toggle };
}

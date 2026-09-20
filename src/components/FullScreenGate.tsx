/**
 * FullScreenGate — applies the "open in full screen" preference.
 *
 * Browsers only allow the Fullscreen API from a user gesture, so this gate
 * tries immediately when the workspace becomes available (sign-in clicks reach
 * us with a live gesture) and, if the browser refuses, retries once on the
 * user's next interaction. It never touches installed apps, which already run
 * without browser chrome.
 */
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { usePrefs } from "@/diary/prefs";
import { isInstalledApp } from "@/pwa";
import {
  canUseFullScreen,
  enterFullScreen,
  exitFullScreen,
  isFullScreenActive,
} from "@/diary/fullscreen";

export function FullScreenGate() {
  const { isAuthenticated } = useAuth();
  const { prefs } = usePrefs();
  const wanted = isAuthenticated && prefs.openInFullScreen;

  useEffect(() => {
    if (!wanted) return;
    if (isInstalledApp() || !canUseFullScreen() || isFullScreenActive()) return;

    let settled = false;
    const attempt = () => {
      if (settled) return;
      void enterFullScreen().then((ok) => {
        if (ok) settled = true;
      });
    };

    attempt();
    // Happens without a gesture? Then wait for the first real interaction.
    window.addEventListener("pointerdown", attempt, true);
    window.addEventListener("keydown", attempt, true);
    return () => {
      settled = true;
      window.removeEventListener("pointerdown", attempt, true);
      window.removeEventListener("keydown", attempt, true);
    };
  }, [wanted]);

  // Turning the setting off (or signing out) should not strand the user in
  // full screen with no way back.
  useEffect(() => {
    if (isInstalledApp()) return;
    if (!wanted && isFullScreenActive()) void exitFullScreen();
  }, [wanted]);

  return null;
}

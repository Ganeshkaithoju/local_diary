/**
 * PWA / install support.
 *
 * Local Diary Core ships a web app manifest, PNG icons and a small offline
 * service worker so it can be installed as a real app: on Android/iOS it lands
 * on the home screen as a mobile app, and on desktop Chrome/Edge it installs
 * into its own window with an app icon and no browser chrome.
 *
 * Nothing here touches diary content — the service worker only ever caches
 * same-origin static assets, and the app shell for offline use.
 */
import { useCallback, useEffect, useState } from "react";

/** Chrome/Edge's install prompt event (not in the standard DOM types yet). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * True when the app is running as an INSTALLED app (standalone window / home
 * screen icon) rather than in a normal browser tab. Used to skip the manual
 * full-screen request, because installed apps already render without toolbars.
 */
export function isInstalledApp(): boolean {
  if (typeof window === "undefined") return false;
  if (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: fullscreen)").matches ||
    window.matchMedia?.("(display-mode: minimal-ui)").matches
  ) {
    return true;
  }
  // iOS Safari predates display-mode; it flags installed apps on navigator.
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || document.referrer.startsWith("android-app://");
}

/** True on iOS/iPadOS, where installing is a manual "Add to Home Screen" step. */
export function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iPadOS =
    navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1;
  return /iPad|iPhone|iPod/.test(ua) || iPadOS;
}

/** Android (including Chrome/WebView) — used for the right install wording. */
export function isAndroidDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

/**
 * Register the offline service worker. Only runs in production builds: in dev
 * the module graph is served straight from Vite, so a worker would only get in
 * the way of hot reloads.
 */
export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;
  if (window.self !== window.top) return; // never register inside an iframe

  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((err) => console.warn("[pwa] service worker not registered:", err));
  });
}

export interface InstallState {
  /** The browser offered an install prompt we can trigger. */
  canInstall: boolean;
  /** Already running as an installed app. */
  installed: boolean;
  /** Manual install instructions are needed (iOS Safari). */
  manualInstructions: boolean;
  /** Show the install affordance at all. */
  available: boolean;
  promptInstall: () => Promise<void>;
}

/** Tracks installability and drives the native install prompt. */
export function useInstallPrompt(): InstallState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isInstalledApp());

  useEffect(() => {
    const onPrompt = (event: Event) => {
      // Keep the event so our own button can trigger it later.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    const mq = window.matchMedia?.("(display-mode: standalone)");
    const sync = () => setInstalled(isInstalledApp());

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    mq?.addEventListener?.("change", sync);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      mq?.removeEventListener?.("change", sync);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  }, [deferred]);

  const manualInstructions = !installed && !deferred && isIOSDevice();

  return {
    canInstall: Boolean(deferred),
    installed,
    manualInstructions,
    available: !installed,
    promptInstall,
  };
}

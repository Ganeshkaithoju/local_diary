import { useState, useEffect } from "react";

export type PlatformType = "windows" | "android" | "macos" | "ios" | "linux" | "other";

export function detectPlatform(): PlatformType {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "other";
  }

  const userAgent = navigator.userAgent || "";
  const platform = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "";

  if (/android/i.test(userAgent)) {
    return "android";
  }

  if (/iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
    return "ios";
  }

  if (/Win/i.test(platform) || /windows/i.test(userAgent)) {
    return "windows";
  }

  if (/Mac/i.test(platform) || /macintosh|mac os x/i.test(userAgent)) {
    return "macos";
  }

  if (/Linux/i.test(platform) || /linux/i.test(userAgent)) {
    return "linux";
  }

  return "other";
}

export function isTauriApp(): boolean {
  return (
    typeof window !== "undefined" &&
    (Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) ||
      Boolean((window as unknown as { __TAURI__?: unknown }).__TAURI__) ||
      "isTauri" in window)
  );
}

export function usePlatform() {
  const [platform, setPlatform] = useState<PlatformType>("other");
  const [isTauri, setIsTauri] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    setIsTauri(isTauriApp());
  }, []);

  return {
    platform,
    isTauri,
    isWindows: platform === "windows",
    isAndroid: platform === "android",
    isApple: platform === "macos" || platform === "ios",
    isMobile: platform === "android" || platform === "ios",
    isWindowsDesktopApp: isTauri && platform === "windows",
    isAndroidNativeApp: isTauri && platform === "android",
  };
}

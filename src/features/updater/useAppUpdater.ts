import { useState, useEffect, useCallback, useRef } from "react";
import { isTauriApp } from "@/lib/platform";
import { toast } from "sonner";

interface UpdateInfo {
  version: string;
  body?: string;
}

export function useAppUpdater() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateRef = useRef<any>(null);

  useEffect(() => {
    // 1. Only native desktop Tauri application performs automatic update checks
    if (!isTauriApp()) return;

    // 2. If offline or in Airplane Mode, skip check completely
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    let isMounted = true;

    // 3. Background non-blocking check with a short deferral to prioritize startup
    const timer = setTimeout(async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();

        if (!isMounted || !update || !update.available) return;

        // Check if user already skipped this version in this session
        const skipped = sessionStorage.getItem("local_diary_update_skipped");
        if (skipped === update.version) return;

        updateRef.current = update;
        setUpdateInfo({
          version: update.version,
          body: update.body ?? undefined,
        });
      } catch {
        // Network error, no release published, or airplane mode:
        // Silently ignore to never block the application or user experience
      }
    }, 4000);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, []);

  const skipUpdate = useCallback(() => {
    if (updateInfo) {
      sessionStorage.setItem("local_diary_update_skipped", updateInfo.version);
    }
    setUpdateInfo(null);
  }, [updateInfo]);

  const installUpdate = useCallback(async () => {
    if (!updateRef.current) return;
    setIsInstalling(true);
    setStatusText("Downloading update…");

    try {
      let downloaded = 0;
      let totalLength = 0;

      await updateRef.current.downloadAndInstall((event: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => {
        if (event.event === "Started") {
          totalLength = event.data?.contentLength ?? 0;
          setStatusText("Downloading update…");
        } else if (event.event === "Progress") {
          downloaded += event.data?.chunkLength ?? 0;
          if (totalLength > 0) {
            const pct = Math.round((downloaded / totalLength) * 100);
            setStatusText(`Downloading update… ${pct}%`);
          }
        } else if (event.event === "Finished") {
          setStatusText("Installing and restarting…");
        }
      });

      setStatusText("Restarting into new version…");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      console.error("Update installation failed:", err);
      toast.error("Failed to apply update. Please check your connection.");
      setIsInstalling(false);
      setStatusText(null);
    }
  }, []);

  return {
    updateInfo,
    isInstalling,
    statusText,
    skipUpdate,
    installUpdate,
  };
}

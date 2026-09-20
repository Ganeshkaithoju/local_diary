/**
 * Settings — app lock, AI key, backup/restore.
 *
 * App lock uses PBKDF2-hashed PINs (never plaintext), and unlock attempts
 * are rate-limited. Backups are portable JSON the user downloads; import
 * validates and never overwrites without confirmation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Archive,
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  Lock,
  Maximize,
  Minimize,
  RotateCcw,
  Share,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { hashPin, randomSalt, verifyAppLock } from "@/diary/applock";
import { downloadBackup, makeBackup, readBackupFile } from "@/diary/backup";
import {
  createInternalBackup,
  deleteInternalBackup,
  listUserBackups,
  restoreInternalBackup,
  type StoredBackupRecord,
} from "@/diary/backupVault";
import { updatePrefs, usePrefs } from "@/diary/prefs";
import { enterFullScreen, useFullScreen } from "@/diary/fullscreen";
import { useInstallPrompt } from "@/pwa";
import { useDiaryStorage } from "@/hooks/use-diary-storage";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/convex/_generated/api";
import { useConvex } from "convex/react";
import {
  UNIQUE_KEY_LENGTH,
  uniqueKeyIssue,
} from "@/convex/uniqueKeyRules";
import type { DiaryBackup } from "@/diary/types";
import type { StorageInfo } from "@/storage";
import { usePlatform } from "@/lib/platform";
import { DOWNLOADS } from "@/config/downloads";

/** The phrase the delete-everything confirmation asks the user to type. */
const DELETE_PHRASE = "DELETE";

/**
 * Unique key — a 6-character handle (≥1 uppercase, ≥1 lowercase, ≥1 digit)
 * the user can sign in with instead of email + password. Uniqueness is
 * enforced server-side; availability is checked live as they type.
 */
function UniqueKeyCard() {
  const client = useConvex();
  const { user } = useAuth();
  const currentKey = user?.uniqueKey ?? null;

  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [availability, setAvailability] = useState<{
    state: "idle" | "checking" | "free" | "taken" | "invalid";
    reason: string | null;
  }>({ state: "idle", reason: null });

  const issue = draft ? uniqueKeyIssue(draft) : null;

  // Live availability check, debounced while the draft passes local rules.
  useEffect(() => {
    if (!draft || issue) {
      setAvailability({
        state: draft ? "invalid" : "idle",
        reason: issue,
      });
      return;
    }
    setAvailability({ state: "checking", reason: null });
    const timer = setTimeout(() => {
      void client
        .query(api.uniqueKey.uniqueKeyAvailable, { key: draft })
        .then((result: { available: boolean; reason: string | null }) => {
          setAvailability({
            state: result.available ? "free" : "taken",
            reason: result.reason,
          });
        })
        .catch(() => setAvailability({ state: "idle", reason: null }));
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const claim = async () => {
    if (!draft || issue || saving) return;
    setSaving(true);
    try {
      await client.mutation(api.uniqueKey.setMyUniqueKey, { key: draft });
      toast.success(
        currentKey
          ? "Unique key updated. Use it next time to sign in."
          : "Unique key created. Use it next time to sign in.",
      );
      setDraft("");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save the key.",
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!currentKey) return;
    const entered = window.prompt(
      `Type your current key (${currentKey}) to remove it:`,
    );
    if (entered === null) return;
    if (entered.trim() !== currentKey) {
      toast.error("That does not match your current key.");
      return;
    }
    try {
      await client.mutation(api.uniqueKey.clearMyUniqueKey, {});
      toast.success("Unique key removed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the key.");
    }
  };

  const canSave =
    !issue && availability.state === "free" && draft !== currentKey && !saving;

  return (
    <Card className="surface">
      <CardHeader>
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-primary" />
          <CardTitle className="text-base">Unique sign-in key</CardTitle>
        </div>
        <CardDescription>
          A 6-character key that works like a username — exactly one person can
          hold it. Sign in next time with just this key instead of your email
          and password.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {currentKey ? (
          <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
            <div>
              <p className="text-xs text-muted-foreground">Your key</p>
              <p className="font-mono text-lg font-semibold tracking-[0.3em]">
                {currentKey}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={remove}>
              Remove
            </Button>
          </div>
        ) : null}

        <div className="grid gap-1.5">
          <Label htmlFor="unique-key-input">
            {currentKey ? "Change to a new key" : "Choose your key"}
          </Label>
          <Input
            id="unique-key-input"
            value={draft}
            onChange={(e) =>
              setDraft(e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, UNIQUE_KEY_LENGTH))
            }
            placeholder="A7b2Cx"
            autoComplete="off"
            className="font-mono tracking-[0.35em] uppercase"
          />
          <p className="text-xs leading-4 text-muted-foreground">
            Exactly {UNIQUE_KEY_LENGTH} characters — at least one capital, one
            lowercase and one number.
          </p>
          {availability.state === "checking" && (
            <p className="text-xs text-muted-foreground">Checking availability…</p>
          )}
          {availability.state === "free" && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              ✓ "{draft}" is available — only you will hold it.
            </p>
          )}
          {availability.state === "taken" && availability.reason && (
            <p className="text-xs text-destructive">{availability.reason}</p>
          )}
          {availability.state === "invalid" && availability.reason && (
            <p className="text-xs text-muted-foreground">{availability.reason}</p>
          )}
        </div>

        <Button onClick={() => void claim()} disabled={!canSave} className="gap-1.5">
          <KeyRound className="size-4" />
          {currentKey ? "Update key" : "Create my key"}
        </Button>
      </CardContent>
    </Card>
  );
}

export function SettingsPage({ onBack }: { onBack: () => void }) {
  const storage = useDiaryStorage();
  const { prefs } = usePrefs();
  const fullscreen = useFullScreen();
  const install = useInstallPrompt();
  const { user } = useAuth();
  const { platform, isWindowsDesktopApp, isAndroidNativeApp } = usePlatform();

  // App lock state
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [showPin, setShowPin] = useState(false);

  // AI key state
  const [apiKey, setApiKey] = useState(prefs.geminiApiKey);

  // In-app Backup Vault state
  const [storedBackups, setStoredBackups] = useState<StoredBackupRecord[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [selectedBackupForRestore, setSelectedBackupForRestore] = useState<StoredBackupRecord | null>(null);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);

  // Calendar selected date (default to today or latest backup date)
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() => new Date());

  const refreshBackups = useCallback(async () => {
    try {
      setLoadingBackups(true);
      const list = await listUserBackups(storage.currentOwnerId);
      setStoredBackups(list);
    } catch (err) {
      console.error("Failed to load application backups:", err);
    } finally {
      setLoadingBackups(false);
    }
  }, [storage.currentOwnerId]);

  useEffect(() => {
    void refreshBackups();
  }, [refreshBackups]);

  // Auto-focus calendar on latest backup when backups load if current selection has none
  useEffect(() => {
    if (storedBackups.length > 0) {
      setSelectedDate((prev) => {
        if (!prev) return new Date(storedBackups[0].exportedAt);
        const hasBackupsOnPrev = storedBackups.some((b) => {
          const d = new Date(b.exportedAt);
          return (
            d.getFullYear() === prev.getFullYear() &&
            d.getMonth() === prev.getMonth() &&
            d.getDate() === prev.getDate()
          );
        });
        return hasBackupsOnPrev ? prev : new Date(storedBackups[0].exportedAt);
      });
    }
  }, [storedBackups]);

  // Calendar modifier to highlight dates with available backups
  const isBackupDate = useCallback(
    (date: Date) => {
      return storedBackups.some((b) => {
        const d = new Date(b.exportedAt);
        return (
          d.getFullYear() === date.getFullYear() &&
          d.getMonth() === date.getMonth() &&
          d.getDate() === date.getDate()
        );
      });
    },
    [storedBackups]
  );

  // Filtered backups for the currently selected date
  const backupsForSelectedDate = useMemo(() => {
    if (!selectedDate) return [];
    return storedBackups.filter((bak) => {
      const d = new Date(bak.exportedAt);
      return (
        d.getFullYear() === selectedDate.getFullYear() &&
        d.getMonth() === selectedDate.getMonth() &&
        d.getDate() === selectedDate.getDate()
      );
    });
  }, [storedBackups, selectedDate]);

  const handleCreateAppBackup = async () => {
    try {
      setCreatingBackup(true);
      const record = await createInternalBackup(storage);
      toast.success(`Backup saved securely in application storage (${record.dateFormatted}).`);
      await refreshBackups();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Backup failed.");
    } finally {
      setCreatingBackup(false);
    }
  };

  const handlePromptRestore = (backup: StoredBackupRecord) => {
    setSelectedBackupForRestore(backup);
    setRestoreConfirmOpen(true);
  };

  const handleConfirmRestore = async () => {
    if (!selectedBackupForRestore) return;
    try {
      setRestoringBackup(true);
      const res = await restoreInternalBackup(storage, selectedBackupForRestore.id, { overwrite: true });
      toast.success(
        `Restored ${res.books} ${res.books === 1 ? "book" : "books"} and ${res.entries} entries from ${selectedBackupForRestore.dateFormatted}.`,
      );
      setRestoreConfirmOpen(false);
      setSelectedBackupForRestore(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restore failed.");
    } finally {
      setRestoringBackup(false);
    }
  };

  const handleDeleteAppBackup = async (backupId: string) => {
    try {
      await deleteInternalBackup(backupId, storage.currentOwnerId);
      toast.success("Backup removed from application storage.");
      await refreshBackups();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed.");
    }
  };

  // Import state
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingBackup, setPendingBackup] = useState<DiaryBackup | null>(null);
  const [pendingCounts, setPendingCounts] = useState<{ books: number; entries: number } | null>(null);
  const [overwrite, setOverwrite] = useState(false);

  // Delete-all-data state: an explicit confirmation step, then a typed
  // confirmation phrase, because this action is irreversible.
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipeConfirmText, setWipeConfirmText] = useState("");
  const [wiping, setWiping] = useState(false);

  const handleSetLock = async () => {
    if (pin.length < 4) {
      toast.error("Choose at least a 4-digit PIN.");
      return;
    }
    if (pin !== pinConfirm) {
      toast.error("PINs do not match.");
      return;
    }
    const salt = randomSalt();
    const hash = await hashPin(pin, salt);
    updatePrefs({ appLockEnabled: true, appLockHash: hash, appLockSalt: salt });
    setPin("");
    setPinConfirm("");
    toast.success("App lock enabled. You'll need this PIN to open your workspace.");
  };

  const handleDisableLock = async () => {
    if (!prefs.appLockEnabled) return;
    const entered = window.prompt("Enter your current PIN to disable app lock:");
    if (entered === null) return;
    const ok = await verifyAppLock(entered, prefs.appLockHash, prefs.appLockSalt);
    if (!ok) {
      toast.error("That PIN is incorrect.");
      return;
    }
    updatePrefs({ appLockEnabled: false, appLockHash: null, appLockSalt: null });
    toast.success("App lock disabled.");
  };

  const handleExport = async () => {
    try {
      const backup = await makeBackup(storage);
      if (!backup.books.length && !backup.entries.length) {
        toast.error("Nothing to back up yet — write something first.");
        return;
      }
      downloadBackup(backup);
      toast.success("Backup downloaded to your device.");
    } catch {
      toast.error("Backup failed.");
    }
  };

  // Storage status & location management
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [isChangingLocation, setIsChangingLocation] = useState(false);

  const refreshStorageInfo = useCallback(async () => {
    try {
      const info = await storage.getStorageInfo();
      setStorageInfo(info);
    } catch (err) {
      console.error("Failed to load storage info:", err);
    }
  }, [storage]);

  useEffect(() => {
    void refreshStorageInfo();
  }, [refreshStorageInfo]);

  const handleOpenDiaryFolder = async () => {
    try {
      if (storage.openStorageFolder) {
        await storage.openStorageFolder();
      }
    } catch {
      toast.error("Could not open diary folder.");
    }
  };

  const handleChangeLocation = async () => {
    try {
      setIsChangingLocation(true);
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select New Local Diary Core Storage Folder",
      });
      if (typeof selected === "string" && selected.trim()) {
        if (storage.changeStorageLocation) {
          await storage.changeStorageLocation(selected.trim());
          await refreshStorageInfo();
          toast.success("Storage location updated successfully.");
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to change storage location";
      toast.error(msg);
    } finally {
      setIsChangingLocation(false);
    }
  };

  const handleFilePicked = async (file: File) => {
    try {
      const backup = await readBackupFile(file);
      setPendingBackup(backup);
      setPendingCounts({
        books: backup.books.length,
        entries: backup.entries.length,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed.");
    }
  };

  const confirmImport = async () => {
    if (!pendingBackup) return;
    try {
      const result = await storage.importBackup(pendingBackup, { overwrite });
      toast.success(
        `Restored ${result.books} ${result.books === 1 ? "book" : "books"} and ${result.entries} entries.` +
          (result.skipped ? ` ${result.skipped} skipped.` : ""),
      );
      setPendingBackup(null);
      setPendingCounts(null);
      setOverwrite(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restore failed.");
    }
  };

  /**
   * Delete every book, every entry and the local preferences for this
   * account on this device. The sign-in survives; the writing does not.
   */
  const handleDeleteAllData = async () => {
    if (wipeConfirmText.trim().toUpperCase() !== DELETE_PHRASE || wiping) return;
    setWiping(true);
    try {
      await storage.deleteAllData();
      // The lock config and the AI key are preferences, not diary content —
      // but they belong to the diary experience, so they go too.
      updatePrefs({
        appLockEnabled: false,
        appLockHash: null,
        appLockSalt: null,
        geminiApiKey: "",
        lastBookId: null,
      });
      toast.success("All diary data was deleted from this device.");
      setWipeOpen(false);
      setWipeConfirmText("");
      onBack();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete the data.");
    } finally {
      setWiping(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
      </header>

      <div className="mt-6 space-y-6">
        {/* Top settings options in a responsive 2-column grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          {/* Unique key — sign in without email + password */}
          {!user?.isAnonymous && <UniqueKeyCard />}

          {/* App lock */}
        <Card className="surface">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Lock className="size-4 text-primary" />
              <CardTitle className="text-base">Workspace app lock</CardTitle>
            </div>
            <CardDescription>
              A second lock for your diary, separate from your account sign-in.
              Stored as a salted hash — never as plain text.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {prefs.appLockEnabled ? (
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center gap-2 text-sm">
                  <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
                  App lock is on
                </div>
                <Button variant="outline" size="sm" onClick={handleDisableLock}>
                  Disable
                </Button>
              </div>
            ) : (
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="lock-pin">New PIN (4+ digits)</Label>
                  <div className="relative">
                    <Input
                      id="lock-pin"
                      type={showPin ? "text" : "password"}
                      inputMode="numeric"
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                      placeholder="••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPin((s) => !s)}
                      className="absolute right-2.5 top-2.5 text-muted-foreground"
                      aria-label={showPin ? "Hide PIN" : "Show PIN"}
                    >
                      {showPin ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="lock-pin-confirm">Confirm PIN</Label>
                  <Input
                    id="lock-pin-confirm"
                    type={showPin ? "text" : "password"}
                    inputMode="numeric"
                    value={pinConfirm}
                    onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  />
                </div>
                <Button onClick={handleSetLock} className="w-full gap-1.5">
                  <KeyRound className="size-4" />
                  Enable app lock
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Storage */}
        <Card className="surface">
          <CardHeader>
            <div className="flex items-center gap-2">
              <HardDrive className="size-4 text-primary" />
              <CardTitle className="text-base">Storage</CardTitle>
            </div>
            <CardDescription>
              {storageInfo?.isNative
                ? "Your diary is stored locally on this device."
                : "Your diary is stored in browser-managed storage."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1 rounded-lg border bg-muted/30 p-3 text-xs">
              <span className="font-semibold text-foreground">Location:</span>
              <p className="break-all font-mono text-muted-foreground">
                {storageInfo?.displayPath || "Loading storage location..."}
              </p>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-3.5" />
                {storageInfo?.isNative ? "Stored on this device" : "Stored in browser storage"}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-3.5" />
                Available offline
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {storageInfo?.canOpenFolder && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenDiaryFolder}
                  className="gap-1.5"
                >
                  <ExternalLink className="size-3.5" />
                  Open Diary Folder
                </Button>
              )}
              {storageInfo?.canChangeLocation && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleChangeLocation}
                  disabled={isChangingLocation}
                  className="gap-1.5"
                >
                  <RotateCcw className="size-3.5" />
                  {isChangingLocation ? "Updating..." : "Change Location"}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                className="gap-1.5"
              >
                <Download className="size-3.5" />
                Export Backup
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* AI key */}
        <Card className="surface">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <CardTitle className="text-base">Gemini API key (optional)</CardTitle>
            </div>
            <CardDescription>
              Needed only for AI helpers like summaries and “ask my books”. The
              key stays on this device and is sent to Google only when you run
              an AI action.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIza…"
              autoComplete="off"
            />
            <Button
              variant="outline"
              onClick={() => {
                updatePrefs({ geminiApiKey: apiKey.trim() });
                toast.success("Gemini key saved locally.");
              }}
            >
              Save key
            </Button>

            {/* How to obtain a key — the full guide lives here, next to the
                field where the key is actually pasted. */}
            <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">
              <p className="font-medium text-foreground">
                How to get a free Gemini API key
              </p>
              <ol className="mt-1.5 list-decimal space-y-1.5 pl-4">
                <li>
                  Open{" "}
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-medium text-primary underline underline-offset-2"
                  >
                    Google AI Studio
                  </a>{" "}
                  <ExternalLink className="inline size-3 align-[-1px]" /> and sign
                  in with your Google account.
                </li>
                <li>Click “Get API key” → “Create API key”.</li>
                <li>
                  Copy the key, paste it in the field above, then choose “Save
                  key”.
                </li>
              </ol>
              <p className="mt-1.5">
                The free tier is enough for personal summaries and questions. The
                key is stored on this device only, and is sent to Google only when
                you run an AI action.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Display — full screen mode */}
        <Card className="surface">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Maximize className="size-4 text-primary" />
              <CardTitle className="text-base">Full screen mode</CardTitle>
            </div>
            <CardDescription>
              Hide the browser toolbar and taskbar while you write or read. This
              applies to browser tabs — the installed app already opens without
              any browser chrome.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 p-3">
              <div>
                <p className="text-sm font-medium">
                  Open in full screen after sign-in
                </p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {fullscreen.installed
                    ? "You are using the installed app, where browser chrome is already hidden."
                    : fullscreen.supported
                      ? "Signing in — or starting a guest session — expands the workspace to the whole screen. Press Esc to leave it."
                      : "This browser does not allow full screen mode."}
                </p>
              </div>
              <Switch
                checked={prefs.openInFullScreen}
                onCheckedChange={(checked) => {
                  updatePrefs({ openInFullScreen: checked });
                  // The click is a live user gesture, so switching this on can
                  // go full screen right away (turning it off exits via the
                  // gate). Already full screen? Then this is a no-op.
                  if (checked) void enterFullScreen();
                }}
                disabled={!fullscreen.supported || fullscreen.installed}
                aria-label="Open in full screen after sign-in"
              />
            </div>
            {fullscreen.supported && !fullscreen.installed && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => void fullscreen.toggle()}
              >
                {fullscreen.active ? (
                  <>
                    <Minimize className="size-4" />
                    Exit full screen
                  </>
                ) : (
                  <>
                    <Maximize className="size-4" />
                    Try full screen now
                  </>
                )}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Installable app */}
        <Card className="surface">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Smartphone className="size-4 text-primary" />
              <CardTitle className="text-base">Install the app</CardTitle>
            </div>
            <CardDescription>
              {isWindowsDesktopApp || isAndroidNativeApp
                ? "Manage your installed Local Diary Core application."
                : "Install Local Diary Core to get an app icon and a window of its own on your phone, tablet or desktop. The app shell is cached, so the installed app still opens without a connection."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isWindowsDesktopApp ? (
              <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
                <ShieldCheck className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-medium text-foreground">
                    ✓ Local Diary Core is installed on this device
                  </p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    You are using the installed desktop application. Your locally stored diary data is available directly from the installed application even when you are offline.
                  </p>
                </div>
              </div>
            ) : isAndroidNativeApp ? (
              <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
                <ShieldCheck className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-medium text-foreground">
                    ✓ Local Diary Core is installed
                  </p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    You are using the installed Android application. Locally stored diary data can be accessed directly from the application, including while offline.
                  </p>
                </div>
              </div>
            ) : platform === "windows" ? (
              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/20 p-3.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <Download className="size-4 text-primary" />
                    <p className="text-sm font-medium text-foreground">
                      Windows Desktop Application
                    </p>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Download the native Windows desktop installer (.exe) for complete offline performance, dedicated window mode, and background updates.
                  </p>
                  <div className="pt-1">
                    <Button asChild size="sm" className="gap-1.5 font-mono text-xs">
                      <a href={DOWNLOADS.windows.url} download>
                        <Download className="size-3.5" />
                        Download for Windows (.exe)
                      </a>
                    </Button>
                  </div>
                </div>

                <div className="space-y-2 pt-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Or install as browser web app
                  </p>
                  {install.installed ? (
                    <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
                      <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
                      You are using the installed web app — no browser chrome, and opens offline.
                    </div>
                  ) : install.canInstall ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => void install.promptInstall()}
                      >
                        <Download className="size-4" />
                        Install browser app
                      </Button>
                      <p className="text-xs leading-5 text-muted-foreground">
                        Adds a progressive web app shortcut through your current browser.
                      </p>
                    </>
                  ) : (
                    <p className="text-xs leading-5 text-muted-foreground">
                      Use the install icon in your browser's address bar to install as a web app.
                    </p>
                  )}
                </div>
              </div>
            ) : platform === "android" ? (
              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/20 p-3.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <Smartphone className="size-4 text-primary" />
                    <p className="text-sm font-medium text-foreground">
                      Install Local Diary Core
                    </p>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Download the Android APK and install Local Diary Core directly on your device. Once installed, the application can be opened directly without using a browser. Locally stored diary data is available offline; account authentication and cloud backup require internet access.
                  </p>
                  <div className="pt-1">
                    <Button asChild size="sm" className="gap-1.5 font-mono text-xs">
                      <a href={DOWNLOADS.android.apkUrl} download={DOWNLOADS.android.apkName}>
                        <Download className="size-3.5" />
                        Download APK ({DOWNLOADS.android.apkName})
                      </a>
                    </Button>
                  </div>
                </div>

                <div className="space-y-2 pt-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Or install as browser web app
                  </p>
                  {install.installed ? (
                    <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
                      <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
                      You are using the installed web app — no browser chrome, and opens offline.
                    </div>
                  ) : install.canInstall ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => void install.promptInstall()}
                      >
                        <Download className="size-4" />
                        Add to Home screen
                      </Button>
                      <p className="text-xs leading-5 text-muted-foreground">
                        Adds a progressive web app shortcut through your current browser.
                      </p>
                    </>
                  ) : (
                    <p className="text-xs leading-5 text-muted-foreground">
                      In Chrome or Edge for Android, open the browser menu (⋮) and tap “Install app” or “Add to Home screen”.
                    </p>
                  )}
                </div>
              </div>
            ) : install.installed ? (
              <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
                <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
                You are using the installed app — no browser chrome, and the app
                opens even when you are offline.
              </div>
            ) : install.canInstall ? (
              <>
                <Button
                  className="gap-1.5"
                  onClick={() => void install.promptInstall()}
                >
                  <Download className="size-4" />
                  Install Local Diary Core
                </Button>
                <p className="text-xs leading-5 text-muted-foreground">
                  Your browser will ask you to confirm, then add the app to your
                  home screen or applications list.
                </p>
              </>
            ) : install.manualInstructions ? (
              <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">
                <p className="font-medium text-foreground">
                  Install on iPhone or iPad
                </p>
                <ol className="mt-1.5 list-decimal space-y-1.5 pl-4">
                  <li>Open Local Diary Core in Safari.</li>
                  <li>
                    Tap the Share button{" "}
                    <Share className="inline size-3 align-[-1px]" /> in the
                    toolbar.
                  </li>
                  <li>Choose “Add to Home Screen”, then tap “Add”.</li>
                </ol>
                <p className="mt-1.5">
                  The app then opens from its own icon and uses the whole screen
                  with no browser chrome.
                </p>
              </div>
            ) : (
              <p className="text-xs leading-5 text-muted-foreground">
                This browser does not offer its own install prompt. In Chrome or
                Edge (desktop or Android) use the install icon in the address
                bar, or open the browser menu and choose “Install app” or “Add
                to Home screen”.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Application-Internal Backup & Restore (Full-width, bottom position) */}
      <Card className="surface">
        <CardHeader>
          <div className="flex items-center gap-2">
            <HardDrive className="size-4 text-primary" />
            <CardTitle className="text-base">Application Backup &amp; Restore</CardTitle>
          </div>
          <CardDescription>
            Backups are encrypted and stored directly within Local Diary Core's private application storage. They are never placed in public Downloads, protecting your private data from accidental deletion or unauthorized sharing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="default"
              onClick={handleCreateAppBackup}
              disabled={creatingBackup}
              className="gap-2"
            >
              <ShieldCheck className="size-4" />
              {creatingBackup ? "Securing Backup…" : "Create Application Backup"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (storedBackups.length > 0) {
                  handlePromptRestore(storedBackups[0]);
                } else {
                  toast.error("No application backups available to restore.");
                }
              }}
              disabled={storedBackups.length === 0 || restoringBackup || creatingBackup}
              className="gap-2"
            >
              <RotateCcw className="size-4" />
              {restoringBackup ? "Restoring…" : "Restore Latest Backup"}
            </Button>
          </div>

          {/* Available Backups by Date */}
          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <div>
                <h4 className="text-sm font-semibold text-foreground">
                  Available Backups (By Date)
                </h4>
                <p className="text-xs text-muted-foreground">
                  Select a highlighted date on the calendar to inspect snapshots and restore or delete them.
                </p>
              </div>
              <span className="font-mono text-xs text-muted-foreground">
                {storedBackups.length} {storedBackups.length === 1 ? "snapshot" : "snapshots"}
              </span>
            </div>

            {loadingBackups ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Loading application backups…
              </p>
            ) : storedBackups.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 p-6 text-center">
                <Archive className="mx-auto size-6 text-muted-foreground/60" />
                <p className="mt-2 text-sm font-medium text-foreground">
                  No application backups found
                </p>
                <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
                  Click “Create Application Backup” above to create your first encrypted restore point stored safely inside the app.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-5 items-start">
                {/* Calendar picker with highlighted backup dates */}
                <div className="rounded-lg border border-border/70 bg-muted/20 p-2 flex flex-col items-center justify-center shrink-0">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(d) => d && setSelectedDate(d)}
                    modifiers={{
                      hasBackup: isBackupDate,
                    }}
                    className="rounded-md"
                  />
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground pt-1 pb-1">
                    <span className="size-2 rounded-full bg-primary inline-block" />
                    <span>Highlighted dates contain backups</span>
                  </div>
                </div>

                {/* Backups for selected date */}
                <div className="space-y-3 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="size-4 text-primary shrink-0" />
                      <p className="text-xs font-semibold text-foreground">
                        {selectedDate
                          ? selectedDate.toLocaleDateString(undefined, {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "Selected Date"}
                      </p>
                    </div>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {backupsForSelectedDate.length}{" "}
                      {backupsForSelectedDate.length === 1 ? "snapshot" : "snapshots"}
                    </span>
                  </div>

                  {backupsForSelectedDate.length > 0 ? (
                    <div
                      className={cn(
                        "space-y-2.5",
                        backupsForSelectedDate.length > 3 &&
                          "max-h-[290px] overflow-y-auto pr-1.5 focus:outline-none"
                      )}
                    >
                      {backupsForSelectedDate.map((bak) => (
                        <div
                          key={bak.id}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 p-3 transition-colors hover:bg-muted/30"
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <Clock className="size-3.5 text-primary shrink-0" />
                              <span className="font-medium text-sm text-foreground">
                                {new Date(bak.exportedAt).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  second: "2-digit",
                                })}
                              </span>
                              <span className="text-xs text-muted-foreground font-mono">
                                ({bak.dateFormatted})
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground font-mono">
                              <span>
                                {bak.booksCount} {bak.booksCount === 1 ? "book" : "books"} ·{" "}
                                {bak.entriesCount} entries
                              </span>
                              <span>•</span>
                              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="size-3" />
                                User: {bak.encodedUserId} (Verified)
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handlePromptRestore(bak)}
                              className="gap-1.5 text-xs font-medium"
                              title="One-click restore from this date"
                            >
                              <RotateCcw className="size-3.5" />
                              Restore
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => void handleDeleteAppBackup(bak.id)}
                              className="size-8 text-muted-foreground hover:text-destructive"
                              title="Delete this backup snapshot"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border/70 p-6 text-center">
                      <CalendarIcon className="mx-auto size-6 text-muted-foreground/60" />
                      <p className="mt-2 text-sm font-medium text-foreground">
                        No backups on this date
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground max-w-xs mx-auto">
                        Select any highlighted date on the calendar with a dot indicator to view its snapshots.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

            {/* Manual JSON Import / Export Options (Foldable) */}
            <div className="border-t border-border/60 pt-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                External File Migration (Optional)
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5 text-xs">
                  <Download className="size-3.5" />
                  Export to .json file
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFilePicked(f);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  className="gap-1.5 text-xs"
                >
                  <Upload className="size-3.5" />
                  Import from .json file
                </Button>
              </div>
            </div>

            {pendingBackup && pendingCounts && (
              <div className="rounded-lg border p-3 text-sm">
                <p className="font-medium">
                  Restore {pendingCounts.books}{" "}
                  {pendingCounts.books === 1 ? "book" : "books"} and{" "}
                  {pendingCounts.entries}{" "}
                  {pendingCounts.entries === 1 ? "entry" : "entries"}?
                </p>
                <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={overwrite}
                    onChange={(e) => setOverwrite(e.target.checked)}
                  />
                  Overwrite existing books with the same id
                </label>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={confirmImport}>
                    Restore
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPendingBackup(null);
                      setPendingCounts(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Danger zone — deleting everything, in red, with a typed
            confirmation so no single tap can destroy a diary. */}
        <Card className="surface border-destructive/30">
          <CardHeader>
            <div className="flex items-center gap-2">
              <TriangleAlert className="size-4 text-destructive" />
              <CardTitle className="text-base">Danger zone</CardTitle>
            </div>
            <CardDescription>
              Permanently remove this diary from this device. Your account and
              sign-in stay, but every book, entry and preference here is gone —
              this cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                setWipeConfirmText("");
                setWipeOpen(true);
              }}
            >
              <Trash2 className="size-4" />
              Delete all data
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Final confirmation for the delete. */}
      <AlertDialog open={wipeOpen} onOpenChange={setWipeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              Delete every book and entry on this device?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes all diary data for this account from this device —
              every book, every entry, the app lock and the saved AI key. There
              is no undo. If you might want your writing back, download a
              backup first.
              <br />
              <br />
              Type <span className="font-mono font-semibold text-foreground">{DELETE_PHRASE}</span>{" "}
              to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={wipeConfirmText}
            onChange={(e) => setWipeConfirmText(e.target.value)}
            placeholder={DELETE_PHRASE}
            aria-label="Type DELETE to confirm"
            autoComplete="off"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Keep the dialog open while the deletion runs; the handler
                // closes it on success.
                e.preventDefault();
                void handleDeleteAllData();
              }}
              disabled={wipeConfirmText.trim().toUpperCase() !== DELETE_PHRASE || wiping}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              <Trash2 className="size-4" />
              {wiping ? "Deleting…" : "Delete everything"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* One-click verified restore confirmation modal */}
      <AlertDialog
        open={restoreConfirmOpen}
        onOpenChange={setRestoreConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RotateCcw className="size-5 text-primary" />
              Restore Backup from {selectedBackupForRestore?.dateFormatted}?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-left">
              <p>
                This will restore <strong>{selectedBackupForRestore?.booksCount} {selectedBackupForRestore?.booksCount === 1 ? "book" : "books"}</strong> and{" "}
                <strong>{selectedBackupForRestore?.entriesCount} {selectedBackupForRestore?.entriesCount === 1 ? "entry" : "entries"}</strong> into your active local workspace.
              </p>
              <div className="rounded-md border bg-muted/30 p-2.5 text-xs font-mono">
                <p className="text-foreground font-semibold">User Identity Verification:</p>
                <p className="text-muted-foreground">
                  Created by: <span className="text-foreground">{selectedBackupForRestore?.encodedUserId}</span> (Verified)
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Only the verified user who created this backup can perform this restore. Existing entries with matching IDs will be updated.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoringBackup}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleConfirmRestore()}
              disabled={restoringBackup}
              className="gap-1.5"
            >
              <CheckCircle2 className="size-4" />
              {restoringBackup ? "Restoring…" : "Confirm & Restore"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

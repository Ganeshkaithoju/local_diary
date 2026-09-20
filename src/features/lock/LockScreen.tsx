/**
 * LockScreen — the diary's own lock, separate from account auth.
 * Failed attempts are rate-limited with escalating delays.
 */
import { useEffect, useRef, useState } from "react";
import { LockKeyhole, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { verifyAppLock } from "@/diary/applock";
import { usePrefs } from "@/diary/prefs";
import { useAuth } from "@/hooks/use-auth";

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { prefs } = usePrefs();
  const { signOut } = useAuth();

  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const failsRef = useRef(0);

  // Escalating lockout: 3 fails → 15s, 5 fails → 60s, 8+ → 5min.
  const lockoutFor = (fails: number): number => {
    if (fails >= 8) return 5 * 60_000;
    if (fails >= 5) return 60_000;
    if (fails >= 3) return 15_000;
    return 0;
  };

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!lockoutUntil) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [lockoutUntil]);

  const remaining = lockoutUntil ? Math.max(0, lockoutUntil - now) : 0;

  const attempt = async () => {
    if (checking || remaining > 0) return;
    setChecking(true);
    setError(null);
    const ok = await verifyAppLock(pin, prefs.appLockHash, prefs.appLockSalt);
    setChecking(false);
    if (ok) {
      failsRef.current = 0;
      onUnlock();
    } else {
      failsRef.current += 1;
      setPin("");
      const delay = lockoutFor(failsRef.current);
      if (delay > 0) {
        setLockoutUntil(Date.now() + delay);
        setError(`Too many attempts. Wait ${Math.ceil(delay / 1000)}s.`);
      } else {
        setError("That PIN doesn't match. Try again.");
      }
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="surface w-full max-w-sm p-8 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <LockKeyhole className="size-7" />
        </div>
        <h1 className="mt-4 text-xl font-semibold">Workspace locked</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter your app lock PIN to continue.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void attempt();
          }}
          className="mt-6 space-y-3"
        >
          <Input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="••••"
            disabled={checking || remaining > 0}
            autoFocus
            className="text-center text-lg tracking-[0.5em]"
          />
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={checking || remaining > 0 || pin.length < 4}
          >
            {remaining > 0
              ? `Locked for ${Math.ceil(remaining / 1000)}s`
              : checking
                ? "Checking…"
                : "Unlock"}
          </Button>
        </form>
        <Button
          variant="ghost"
          size="sm"
          className="mt-4 gap-1.5 text-muted-foreground"
          onClick={async () => {
            await signOut();
            window.location.href = "/auth";
          }}
        >
          <LogOut className="size-4" />
          Sign out instead
        </Button>
      </div>
    </div>
  );
}

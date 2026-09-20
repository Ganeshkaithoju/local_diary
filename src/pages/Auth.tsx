/**
 * Auth — sign in, sign up, sign in with a unique key, or continue as guest.
 *
 * The account credential is email + password (the Password provider). A user
 * who already has an account can instead sign in with the 6-character unique
 * key they created in Settings — one short handle instead of email +
 * password. New accounts get a one-time "create your unique key" prompt that
 * deep-links into Settings (see Dashboard).
 */
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { requestFullScreenOnSignIn } from "@/diary/fullscreen";
import {
  UNIQUE_KEY_LENGTH,
  uniqueKeyIssue,
  markUniqueKeyPrompted,
} from "@/convex/uniqueKeyRules";
import logo from "@/assets/logo.svg";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  UserX,
} from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback = "/dashboard",
) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

type Mode = "signIn" | "signUp" | "uniqueKey";

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );

  const [mode, setMode] = useState<Mode>(() =>
    searchParams.get("mode") === "key" ? "uniqueKey" : "signIn",
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);

  /** Shared post-auth transition: full screen (if opted in) + redirect. */
  const finishAuth = () => {
    // Still inside the click's user gesture — the only moment the browser
    // lets us go full screen (only when the user asked for it in Settings).
    requestFullScreenOnSignIn();
    navigate(redirect);
  };

  const handlePasswordSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = (formData.get("email") as string).trim();
    const password = formData.get("password") as string;

    if (mode === "signUp") {
      const confirm = formData.get("confirmPassword") as string;
      if (password !== confirm) {
        setError("The passwords do not match.");
        return;
      }
    }

    setIsLoading(true);
    setError(null);
    try {
      await signIn("password", {
        email,
        password,
        flow: mode === "signUp" ? "signUp" : "signIn",
      });
      // New accounts get the one-time "create your unique key" prompt on
      // the dashboard; returning sign-ins do not.
      if (mode === "signUp") markUniqueKeyPrompted();
      finishAuth();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Sign-in failed. Please try again.";
      setError(
        /already exists|already registered/i.test(message) && mode === "signUp"
          ? "An account with this email already exists — sign in instead."
          : /invalid|incorrect|credentials/i.test(message)
            ? "That email and password don't match an account."
            : message,
      );
      setIsLoading(false);
      form.reset();
    }
  };

  const handleUniqueKeySubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const key = (formData.get("key") as string).trim();
    const issue = uniqueKeyIssue(key);
    if (issue) {
      setError(issue);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await signIn("unique-key", {
        key,
        identifier: deviceId(),
      });
      finishAuth();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "That key didn't match an account.",
      );
      setIsLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await signIn("anonymous");
      finishAuth();
    } catch (err) {
      console.error("Guest login error:", err);
      setError(
        `Failed to sign in as guest: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Auth Content */}
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center justify-center h-full flex-col">
          <Card className="relative min-w-[350px] pb-0 border shadow-md">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute left-3 top-3 gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => navigate("/")}
            >
              <ArrowLeft className="size-4" />
              Back
            </Button>
            <CardHeader className="text-center">
              <div className="flex justify-center">
                <img
                  src={logo}
                  alt="Local Diary Core"
                  width={64}
                  height={64}
                  className="rounded-lg mb-4 mt-4 cursor-pointer"
                  onClick={() => navigate("/")}
                />
              </div>
              <CardTitle className="text-xl">Open your workspace</CardTitle>
              <CardDescription>
                {mode === "signUp"
                  ? "Create your account — it takes less than a minute."
                  : mode === "uniqueKey"
                    ? "Use the 6-character key you created in Settings."
                    : "Sign in to Local Diary Core, or create an account to start writing."}
              </CardDescription>

              {/* Mode switcher */}
              <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => {
                    setMode("signIn");
                    setError(null);
                  }}
                  className={
                    mode === "signIn"
                      ? "rounded-md bg-background px-2 py-1.5 shadow-sm"
                      : "rounded-md px-2 py-1.5 text-muted-foreground hover:text-foreground"
                  }
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("signUp");
                    setError(null);
                  }}
                  className={
                    mode === "signUp"
                      ? "rounded-md bg-background px-2 py-1.5 shadow-sm"
                      : "rounded-md px-2 py-1.5 text-muted-foreground hover:text-foreground"
                  }
                >
                  Sign up
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("uniqueKey");
                    setError(null);
                  }}
                  className={
                    mode === "uniqueKey"
                      ? "rounded-md bg-background px-2 py-1.5 shadow-sm"
                      : "rounded-md px-2 py-1.5 text-muted-foreground hover:text-foreground"
                  }
                >
                  Unique key
                </button>
              </div>
            </CardHeader>

            {mode === "uniqueKey" ? (
              <form onSubmit={handleUniqueKeySubmit}>
                <CardContent>
                  <div className="grid gap-1.5">
                    <Label htmlFor="auth-key" className="flex items-center gap-1.5">
                      <KeyRound className="size-3.5" />
                      Your unique key
                    </Label>
                    <Input
                      id="auth-key"
                      name="key"
                      placeholder="A7b2Cx"
                      autoComplete="off"
                      autoCapitalize="characters"
                      maxLength={UNIQUE_KEY_LENGTH}
                      className="font-mono tracking-[0.35em] uppercase"
                      disabled={isLoading}
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      {UNIQUE_KEY_LENGTH} characters — one capital, one
                      lowercase, one number.
                    </p>
                  </div>
                  {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
                </CardContent>
                <CardFooter className="flex-col gap-2 pb-6">
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        Sign in with key
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    No key yet? Sign in with email, then create one in
                    Settings.
                  </p>
                </CardFooter>
              </form>
            ) : (
              <form onSubmit={handlePasswordSubmit}>
                <CardContent>
                  <div className="grid gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="auth-email" className="flex items-center gap-1.5">
                        <Mail className="size-3.5" />
                        Email
                      </Label>
                      <Input
                        id="auth-email"
                        name="email"
                        placeholder="name@example.com"
                        type="email"
                        autoComplete="email"
                        disabled={isLoading}
                        required
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="auth-password" className="flex items-center gap-1.5">
                        <Lock className="size-3.5" />
                        Password
                      </Label>
                      <PasswordInput
                        id="auth-password"
                        name="password"
                        minLength={8}
                        disabled={isLoading}
                        required
                      />
                    </div>
                    {mode === "signUp" && (
                      <div className="grid gap-1.5">
                        <Label htmlFor="auth-confirm">Confirm password</Label>
                        <PasswordInput
                          id="auth-confirm"
                          name="confirmPassword"
                          minLength={8}
                          disabled={isLoading}
                          required
                        />
                      </div>
                    )}
                  </div>
                  {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

                  <div className="mt-4">
                    <div className="relative flex items-center">
                      <span className="w-full border-t" />
                    </div>

                    <Button
                      type="submit"
                      className="w-full mt-4"
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          {mode === "signUp" ? "Create account" : "Sign in"}
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </>
                      )}
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      className="w-full mt-2"
                      onClick={handleGuestLogin}
                      disabled={isLoading}
                    >
                      <UserX className="mr-2 h-4 w-4" />
                      Continue as guest — data stays on this device
                    </Button>
                  </div>
                </CardContent>
              </form>
            )}

            <div className="py-4 px-6 text-xs text-center text-muted-foreground bg-muted border-t rounded-b-lg">
              Secured by{" "}
              <a
                href="https://freebuff.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-primary transition-colors"
              >
                freebuff.com
              </a>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Password field with a visibility toggle. */
function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        className={props.className}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
        aria-label={visible ? "Hide password" : "Show password"}
        tabIndex={-1}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

/** Stable per-browser identifier for the key sign-in rate limit. */
function deviceId(): string {
  try {
    const KEY = "my-diary:device-id";
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "unknown-device";
  }
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}

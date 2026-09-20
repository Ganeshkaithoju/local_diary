/**
 * Download — Official installers and distribution hub for Local Diary Core.
 *
 * Provides genuine Windows desktop installers (.exe), Android packages (Google Play + direct APK),
 * and Web/PWA launcher.
 */
import { Link } from "react-router";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Download,
  ExternalLink,
  Laptop,
  Smartphone,
  Globe,
  ShieldCheck,
  Terminal,
  Cpu,
  HardDrive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DOWNLOADS } from "@/config/downloads";
import { usePlatform } from "@/lib/platform";

export default function DownloadPage() {
  const { isWindows, isAndroid, isWindowsDesktopApp, isAndroidNativeApp } =
    usePlatform();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <Link to="/" className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                <BookOpen className="size-4.5" />
              </div>
              <span className="text-[15px] font-semibold tracking-tight">
                Local Diary Core
              </span>
            </Link>
            <span className="meta-label hidden rounded border px-1.5 py-0.5 sm:inline-block">
              v{DOWNLOADS.appVersion}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="font-mono text-xs">
              <Link to="/">home</Link>
            </Button>
            <Button asChild size="sm" className="gap-1.5 font-mono text-xs">
              <Link to={DOWNLOADS.web.workspaceUrl}>
                open_workspace
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/60 py-16 sm:py-24">
        <div aria-hidden className="grid-backdrop pointer-events-none absolute inset-0 opacity-60" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_0%,--alpha(var(--color-primary)/9%),transparent)]"
        />
        <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            <p className="meta-label inline-flex items-center gap-2">
              <Terminal className="size-3.5 text-primary" />
              official release channels · v{DOWNLOADS.appVersion}
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
              Get Local Diary Core for your device
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              Built on local-first storage. Every word stays on your machine,
              with real 3D page turns and optional cloud sync.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Main Downloads Matrix */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-3">
          {/* Windows Desktop */}
          <div
            className={`surface relative flex flex-col justify-between rounded-xl p-6 sm:p-8 transition-all ${
              isWindows
                ? "border-primary/60 ring-2 ring-primary/20 shadow-[0_0_30px_rgba(234,179,8,0.1)]"
                : "border-border/60"
            }`}
          >
            {isWindows && (
              <div className="absolute -top-3 right-6 rounded-full bg-primary px-3 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
                Detected Platform
              </div>
            )}
            <div>
              <div className="flex size-12 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                <Laptop className="size-6" />
              </div>
              <div className="mt-5">
                <p className="meta-label">desktop app</p>
                <h2 className="mt-1 text-2xl font-semibold">Windows</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Native Windows desktop application packaged with Tauri 2. Includes Start Menu shortcut, optional desktop icon, and automated updates.
                </p>
              </div>

              <div className="mt-6 space-y-2 border-t border-border/60 pt-4 text-xs font-mono text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>Installer:</span>
                  <span className="text-foreground">{DOWNLOADS.windows.installerName}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Architecture:</span>
                  <span className="text-foreground">{DOWNLOADS.windows.architecture}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>OS Support:</span>
                  <span className="text-foreground">{DOWNLOADS.windows.minOsVersion}</span>
                </div>
              </div>

              <ul className="mt-6 space-y-2 text-xs text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-primary shrink-0" />
                  <span>Real Windows .exe setup installer</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-primary shrink-0" />
                  <span>Full offline IndexedDB storage</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-primary shrink-0" />
                  <span>Start Menu & desktop integration</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-primary shrink-0" />
                  <span>Zero runtime prerequisites for users</span>
                </li>
              </ul>
            </div>

            <div className="mt-8 pt-6 border-t border-border/60">
              {isWindowsDesktopApp ? (
                <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
                  <ShieldCheck className="size-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <div>
                    <p className="font-medium text-foreground">✓ Local Diary Core is installed</p>
                    <p className="text-xs text-muted-foreground">You are running the installed desktop application.</p>
                  </div>
                </div>
              ) : (
                <>
                  <Button asChild size="lg" className="w-full gap-2 font-mono">
                    <a href={DOWNLOADS.windows.url} download>
                      <Download className="size-4" />
                      Download for Windows
                    </a>
                  </Button>
                  <p className="mt-2 text-center font-mono text-[11px] text-muted-foreground">
                    SHA-256 verified release · v{DOWNLOADS.windows.version}
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Android App */}
          <div
            className={`surface relative flex flex-col justify-between rounded-xl p-6 sm:p-8 transition-all ${
              isAndroid
                ? "border-primary/60 ring-2 ring-primary/20 shadow-[0_0_30px_rgba(234,179,8,0.1)]"
                : "border-border/60"
            }`}
          >
            {isAndroid && (
              <div className="absolute -top-3 right-6 rounded-full bg-primary px-3 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
                Detected Platform
              </div>
            )}
            <div>
              <div className="flex size-12 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                <Smartphone className="size-6" />
              </div>
              <div className="mt-5">
                <p className="meta-label">mobile & tablet</p>
                <h2 className="mt-1 text-2xl font-semibold">Android</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Optimized for Android smartphones and tablets with touch gesture book flipping, responsive layouts, and local-first memory.
                </p>
              </div>

              <div className="mt-6 space-y-2 border-t border-border/60 pt-4 text-xs font-mono text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>Package ID:</span>
                  <span className="text-foreground">{DOWNLOADS.android.packageId}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Format:</span>
                  <span className="text-foreground">Direct APK + Google Play AAB</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>OS Support:</span>
                  <span className="text-foreground">{DOWNLOADS.android.minAndroidVersion}</span>
                </div>
              </div>

              <ul className="mt-6 space-y-2 text-xs text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-primary shrink-0" />
                  <span>Touch-responsive book page flips</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-primary shrink-0" />
                  <span>Adaptive phone & tablet UI layouts</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-primary shrink-0" />
                  <span>Local database & offline support</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-primary shrink-0" />
                  <span>Convex cloud synchronization</span>
                </li>
              </ul>
            </div>

            <div className="mt-8 pt-6 border-t border-border/60 space-y-2">
              {isAndroidNativeApp ? (
                <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
                  <ShieldCheck className="size-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <div>
                    <p className="font-medium text-foreground">✓ Local Diary Core is installed</p>
                    <p className="text-xs text-muted-foreground">You are using the installed Android application. Locally stored diary data can be accessed directly, including while offline.</p>
                  </div>
                </div>
              ) : (
                <>
                  <Button asChild size="lg" className="w-full gap-2 font-mono">
                    <a href={DOWNLOADS.android.apkUrl} download={DOWNLOADS.android.apkName}>
                      <Download className="size-4" />
                      {isAndroid ? "Download APK" : "Download for Android"}
                    </a>
                  </Button>
                  <p className="text-center font-mono text-[11px] text-muted-foreground">
                    Local Diary Core {DOWNLOADS.android.version} · {DOWNLOADS.android.apkName}
                  </p>
                  {DOWNLOADS.android.isStorePublished ? (
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="w-full gap-2 font-mono text-xs mt-2"
                    >
                      <a
                        href={DOWNLOADS.android.storeUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink className="size-3.5" />
                        Get it on Google Play
                      </a>
                    </Button>
                  ) : (
                    <p className="text-center font-mono text-[10px] text-muted-foreground pt-1">
                      Direct APK manual install · Google Play release (AAB) in review
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Web / PWA */}
          <div className="surface relative flex flex-col justify-between rounded-xl border border-border/60 p-6 sm:p-8">
            <div>
              <div className="flex size-12 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                <Globe className="size-6" />
              </div>
              <div className="mt-5">
                <p className="meta-label">browser & pwa</p>
                <h2 className="mt-1 text-2xl font-semibold">Web App</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Run directly in Chrome, Edge, Safari, or Firefox without installing software, or add to your home screen as a standalone PWA.
                </p>
              </div>

              <div className="mt-6 space-y-2 border-t border-border/60 pt-4 text-xs font-mono text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>Engine:</span>
                  <span className="text-foreground">Modern Web Standards</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>PWA Offline:</span>
                  <span className="text-foreground">Service Worker Shell</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Compatibility:</span>
                  <span className="text-foreground">Any Modern Browser</span>
                </div>
              </div>

              <ul className="mt-6 space-y-2 text-xs text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-primary shrink-0" />
                  <span>Instant access with zero download</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-primary shrink-0" />
                  <span>Full Progressive Web App (PWA) install</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-primary shrink-0" />
                  <span>Service worker offline caching</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-primary shrink-0" />
                  <span>Desktop & mobile browser support</span>
                </li>
              </ul>
            </div>

            <div className="mt-8 pt-6 border-t border-border/60">
              <Button asChild size="lg" variant="secondary" className="w-full gap-2 font-mono">
                <Link to={DOWNLOADS.web.workspaceUrl}>
                  Open Local Diary Core
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <p className="mt-2 text-center font-mono text-[11px] text-muted-foreground">
                Launch directly in current browser
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Technical Guarantee Strip */}
      <section className="border-t border-border/60 bg-card/40 py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid gap-6 sm:grid-cols-3 font-mono text-xs">
            <div className="surface p-6">
              <div className="flex items-center gap-2 text-primary font-semibold">
                <HardDrive className="size-4" />
                <span>Zero Server Storage</span>
              </div>
              <p className="mt-2 text-muted-foreground leading-5">
                Whether installed via Windows .exe, Android APK, or browser, your diary entries remain exclusively in local storage on your device.
              </p>
            </div>

            <div className="surface p-6">
              <div className="flex items-center gap-2 text-primary font-semibold">
                <ShieldCheck className="size-4" />
                <span>Zero Telemetry on Text</span>
              </div>
              <p className="mt-2 text-muted-foreground leading-5">
                Neither the desktop nor the mobile application monitors, collects, or logs diary text, journal titles, or author notes.
              </p>
            </div>

            <div className="surface p-6">
              <div className="flex items-center gap-2 text-primary font-semibold">
                <Cpu className="size-4" />
                <span>Genuine Native Packaging</span>
              </div>
              <p className="mt-2 text-muted-foreground leading-5">
                Powered by Tauri 2. Uses minimal memory compared to heavy Electron wrappers, giving you instant startup and battery efficiency.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60 py-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-2 px-4 text-center sm:px-6">
          <div className="flex items-center gap-2">
            <BookOpen className="size-4 text-primary" />
            <span className="font-semibold">Local Diary Core</span>
          </div>
          <p className="meta-label">
            windows · android · web · offline first
          </p>
        </div>
      </footer>
    </div>
  );
}

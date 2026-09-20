/**
 * Landing — Local Diary Core's public face.
 *
 * Dark, technical, developer-facing: grid backdrop, mono metadata labels,
 * quiet neutrals, amber accent. Hero shows a live mini flipbook because the
 * page-flip is the product.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  CloudOff,
  Download,
  Fingerprint,
  Lock,
  ScrollText,
  Server,
  Sparkles,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { DOWNLOADS } from "@/config/downloads";
import { isTauriApp, usePlatform } from "@/lib/platform";

const PAGES = [
  { date: "March 3", title: "First rain of the year", text: "The street smelled of wet earth and cardamom tea…" },
  { date: "March 11", title: "A slow Sunday", text: "Read by the window until the light turned gold…" },
  { date: "March 19", title: "Airport thoughts", text: "Gate 14, coffee gone cold, watching planes lift…" },
];

const SPEC_SHEET = [
  ["storage", "IndexedDB — lives on the reader's device"],
  ["network", "zero required · offline-native"],
  ["format", "portable JSON backup + Markdown export"],
  ["sync", "versioned schema · cloud optional"],
  ["ai", "strictly opt-in · user-supplied key"],
];

export default function Landing() {
  const { isAuthenticated } = useAuth();
  const { isWindows, isAndroid } = usePlatform();
  const navigate = useNavigate();
  const [page, setPage] = useState(0);

  // When running as an installed Tauri application, proceed directly to workspace or auth
  useEffect(() => {
    if (isTauriApp()) {
      if (isAuthenticated) {
        navigate("/dashboard", { replace: true });
      } else {
        navigate("/auth?returnTo=%2Fdashboard", { replace: true });
      }
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    const t = setInterval(() => setPage((p) => (p + 1) % PAGES.length), 3200);
    return () => clearInterval(t);
  }, []);

  const ctaHref = isAuthenticated ? "/dashboard" : "/auth?returnTo=%2Fdashboard";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
              <BookOpen className="size-4.5" />
            </div>
            <span className="text-[15px] font-semibold tracking-tight">
              Local Diary Core
            </span>
            <span className="meta-label hidden rounded border px-1.5 py-0.5 sm:inline-block">
              v1.1
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="gap-1.5 font-mono text-xs"
            >
              <Link to="/auth?mode=key">
                <Fingerprint className="size-3.5" />
                key_login
              </Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="gap-1.5 font-mono text-xs"
            >
              <Link to="/download">
                <Download className="size-3.5" />
                download
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="font-mono text-xs">
              <Link to="/auth">sign_in</Link>
            </Button>
            <Button asChild size="sm" className="gap-1.5 font-mono text-xs">
              <Link to={ctaHref}>
                open_workspace
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="grid-backdrop pointer-events-none absolute inset-0 opacity-60" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_0%,--alpha(var(--color-primary)/9%),transparent)]"
        />
        <div className="relative mx-auto grid w-full max-w-6xl gap-14 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pb-28 lg:pt-24">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            <p className="meta-label flex items-center gap-2">
              <Terminal className="size-3.5 text-primary" />
              local-first writing engine
            </p>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.4rem]">
              A writing workspace that{" "}
              <span className="text-primary">runs on your device</span>, not on
              our servers.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">
              Local Diary Core is where teams and writers produce diaries,
              books and long-form stories — with a reader that behaves like a
              real book, page flips included. Every word is stored locally and
              stays exportable, portable and private.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {isWindows ? (
                <Button size="lg" className="gap-2 font-mono" asChild>
                  <a href={DOWNLOADS.windows.url} download>
                    <Download className="size-4" />
                    Download for Windows
                  </a>
                </Button>
              ) : isAndroid ? (
                <Button size="lg" className="gap-2 font-mono" asChild>
                  <a href={DOWNLOADS.android.storeUrl} target="_blank" rel="noreferrer">
                    <Download className="size-4" />
                    Get it on Google Play
                  </a>
                </Button>
              ) : (
                <Button size="lg" className="gap-2 font-mono" asChild>
                  <Link to={ctaHref}>
                    Deploy your workspace
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              )}
              <Button
                size="lg"
                variant="outline"
                className="gap-2 font-mono"
                asChild
              >
                <Link to="/download">
                  downloads
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <span className="opacity-70">Platforms:</span>
              <a
                href={DOWNLOADS.windows.url}
                download
                className="hover:text-primary transition-colors underline-offset-4 hover:underline"
              >
                Windows (.exe)
              </a>
              <span>·</span>
              <Link
                to="/download"
                className="hover:text-primary transition-colors underline-offset-4 hover:underline"
              >
                Android (Play / APK)
              </Link>
              <span>·</span>
              <Link
                to={ctaHref}
                className="hover:text-primary transition-colors underline-offset-4 hover:underline"
              >
                Web App
              </Link>
            </div>
            <p className="meta-label mt-5">
              runs offline · installable · zero telemetry on content
            </p>
          </motion.div>

          {/* Mini flipbook — the product, demonstrated */}
          <motion.div
            initial={{ opacity: 0, y: 24, rotate: -2 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ duration: 0.6, delay: 0.15, ease: "easeOut" }}
            className="relative mx-auto w-full max-w-md"
          >
            <div className="meta-label absolute -top-7 left-0">
              // live preview · page_flip rendering
            </div>
            <div
              className="paper relative aspect-[3/4] rounded-xl shadow-[0_40px_80px_-32px_rgba(0,0,0,0.65)] ring-1 ring-black/20"
              aria-hidden
            >
              <div className="paper-lines flex h-full flex-col p-8">
                <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink-soft">
                  {PAGES[page].date}
                </p>
                <h3 className="mt-2 font-serif text-2xl font-semibold text-ink">
                  {PAGES[page].title}
                </h3>
                <div className="mt-3 h-px w-14 bg-ink/20" />
                <p className="mt-4 text-[15px] leading-8 text-ink">
                  {PAGES[page].text}
                </p>
                <div className="mt-auto flex items-center justify-between font-mono text-[11px] text-ink-soft">
                  <span>render: flip</span>
                  <span className="tabular-nums">{String(page + 3).padStart(3, "0")}</span>
                </div>
              </div>
              <motion.div
                key={page}
                initial={{ rotateY: 24, opacity: 0.5, transformOrigin: "left center" }}
                animate={{ rotateY: 0, opacity: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-l from-black/10 to-transparent"
              />
            </div>
            <div className="absolute -bottom-5 left-1/2 h-6 w-[85%] -translate-x-1/2 rounded-[50%] bg-black/40 blur-xl" />
          </motion.div>
        </div>
      </section>

      {/* Spec strip */}
      <section id="spec" className="border-y border-border/60 bg-card/40">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="meta-label">spec sheet</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                The architecture, in five lines
              </h2>
            </div>
            <p className="max-w-md text-sm text-muted-foreground">
              Built so a publisher, studio or writing team can hand it to
              authors without handing over their manuscripts.
            </p>
          </div>
          <div className="mt-8 overflow-hidden rounded-xl border bg-card font-mono text-[13px]">
            {SPEC_SHEET.map(([key, value], i) => (
              <div
                key={key}
                className={`flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:gap-6 ${
                  i > 0 ? "border-t border-border/60" : ""
                }`}
              >
                <span className="w-24 shrink-0 text-primary">{key}</span>
                <span className="text-muted-foreground">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
        <p className="meta-label">capabilities</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight">
          Built like a book. Engineered like infrastructure.
        </h2>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Feature
            icon={<BookOpen className="size-5" />}
            title="Physical page-flip reader"
            text="Cover, contents, numbered pages and a real 3D page turn — mouse, touch or arrow keys. The reading experience is the feature, not a garnish."
          />
          <Feature
            icon={<ScrollText className="size-5" />}
            title="Made for diaries, books & stories"
            text="Split work into independent volumes — journals, manuscripts, story bibles — each with its own cover, contents and reading order."
          />
          <Feature
            icon={<CloudOff className="size-5" />}
            title="Offline-native core"
            text="Writing and reading never touch the network. Entries persist on the device and survive dead zones, airplane mode and outages."
          />
          <Feature
            icon={<Lock className="size-5" />}
            title="Two-layer access control"
            text="Account sign-in, plus a separate workspace lock stored only as a salted PBKDF2 hash. Plaintext never exists, even on your own disk."
          />
          <Feature
            icon={<Download className="size-5" />}
            title="Portable by format"
            text="One-click JSON backup, Markdown per book, validated restore. No lock-in: your catalog outlives any vendor, including us."
          />
          <Feature
            icon={<Sparkles className="size-5" />}
            title="AI, explicitly invoked"
            text="Optional Gemini helpers — summaries, title ideas, ask-your-workspace — run only on button press, only on selected volumes."
          />
        </div>
      </section>

      {/* Workflow strip */}
      <section className="border-y border-border/60 bg-card/40">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <p className="meta-label">workflow</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">
            The loop your writers already know
          </h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                step: "01",
                title: "Create the volume",
                text: "A workspace holds many books — one per project, client or life.",
              },
              {
                step: "02",
                title: "Write with autosave",
                text: "Rich formatting, debounced local saves, word counts. Nothing is ever lost to a dropped connection.",
              },
              {
                step: "03",
                title: "Read it as a book",
                text: "Flip real pages, browse the auto-generated contents, jump to any entry.",
              },
              {
                step: "04",
                title: "Back up & hand over",
                text: "Export JSON or Markdown whenever a manuscript or archive is due.",
              },
            ].map((s) => (
              <div key={s.step} className="border-l-2 border-primary/40 pl-4">
                <p className="font-mono text-sm text-primary">{s.step}</p>
                <h3 className="mt-2 font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                  {s.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* For organizations */}
      <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
        <div className="surface relative overflow-hidden p-8 sm:p-12">
          <div
            aria-hidden
            className="grid-backdrop pointer-events-none absolute inset-0 opacity-40"
          />
          <div className="relative grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <p className="meta-label flex items-center gap-2">
                <Server className="size-3.5 text-primary" />
                for organizations
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">
                Your writers keep the rights. You keep the oversight.
              </h2>
              <p className="mt-4 max-w-xl leading-7 text-muted-foreground">
                Give each author an isolated workspace where their drafts stay
                on their own machine, with per-account data boundaries and a
                full admin area for catalog oversight, book management and
                backup tooling. Content never enters our logs or analytics.
              </p>
              <ul className="mt-6 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                {[
                  "Per-account isolated databases",
                  "Admin catalog & stats console",
                  "Backup / restore tooling built in",
                  "No diary content in telemetry",
                ].map((li) => (
                  <li key={li} className="flex items-center gap-2">
                    <Fingerprint className="size-3.5 shrink-0 text-primary" />
                    {li}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border bg-background/60 p-6 font-mono text-[13px] leading-7">
              <p className="text-muted-foreground">
                <span className="text-primary">$</span> local-diary-core init
              </p>
              <p className="text-muted-foreground">✓ workspace created — local</p>
              <p className="text-muted-foreground">✓ storage: IndexedDB</p>
              <p className="text-muted-foreground">✓ page-flip engine: ready</p>
              <p className="text-muted-foreground">✓ sync: optional (off)</p>
              <p className="mt-2 text-foreground">
                ▸ sign in to start your first book
              </p>
              <Button size="sm" className="mt-4 gap-1.5 font-mono" asChild>
                <Link to={ctaHref}>
                  open_workspace
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-border/60 bg-card/40 py-20">
        <div className="mx-auto max-w-2xl px-4 text-center sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight">
            Start the first page
          </h2>
          <p className="mt-3 text-muted-foreground">
            Sign in, create a volume, and feel the difference of a diary that
            actually behaves like one — on your machine, under your control.
          </p>
          <div className="mt-8 flex justify-center">
            <Button size="lg" className="gap-2 font-mono" asChild>
              <Link to={ctaHref}>
                Deploy your workspace
                <ArrowRight className="size-4" />
              </Link>
            </Button>
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
            local first · offline first · private first
          </p>
        </div>
      </footer>
    </div>
  );
}

function Feature({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="surface surface-hover p-6">
      <div className="flex size-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
        {icon}
      </div>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{text}</p>
    </div>
  );
}

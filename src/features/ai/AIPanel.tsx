/**
 * AIPanel — optional, explicitly user-initiated AI.
 *
 * Privacy rules: nothing is sent to Gemini unless the user presses the
 * button, and only the entries they chose for that action are included.
 * Requires a user-supplied key configured in Settings.
 */
import { useState } from "react";
import { KeyRound, Loader2, MoveRight, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { resolveProvider } from "@/diary/gemini";
import { usePrefs } from "@/diary/prefs";
import type { DiaryEntry } from "@/diary/types";

export function AIPanel({
  entries,
  bookTitle,
  onOpenSettings,
}: {
  entries: DiaryEntry[];
  bookTitle: string;
  /** Opens Settings where the user adds their own Gemini key. */
  onOpenSettings: () => void;
}) {
  const { prefs } = usePrefs();
  const [mode, setMode] = useState<"summarize" | "ask">("summarize");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!prefs.geminiApiKey) {
      toast.error("Add your Gemini API key in Settings first.");
      return;
    }
    const active = entries.filter((e) => !e.deletedAt);
    if (!active.length) {
      toast.error("There are no entries to work with yet.");
      return;
    }
    setBusy(true);
    setAnswer("");
    try {
      const provider = resolveProvider();
      const result =
        mode === "summarize"
          ? await provider.summarize(active, prefs.geminiApiKey)
          : await provider.ask(active, question, prefs.geminiApiKey);
      setAnswer(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI request failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="surface p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">Reflect with AI (optional)</h3>
        </div>
        {/* Animated arrow → Settings, where the key is added */}
        <button
          type="button"
          onClick={onOpenSettings}
          title="Add your Gemini API key in Settings"
          aria-label="Open settings to add your Gemini API key"
          className="group flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
        >
          <KeyRound className="size-3" />
          API key
          <MoveRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-1 motion-safe:animate-pulse" />
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Runs only when you ask, using your own Gemini key. Only entries from
        “{bookTitle}” are included — nothing else leaves your device.
      </p>
      {!prefs.geminiApiKey && (
        <div className="mt-3 rounded-lg border border-primary/25 bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">
          <p className="font-medium text-foreground">Add a free Gemini API key</p>
          <p className="mt-1">
            Open{" "}
            <button
              type="button"
              onClick={onOpenSettings}
              className="font-medium text-primary underline underline-offset-2"
            >
              Settings → Gemini API key
            </button>{" "}
            for the step-by-step guide to creating one in Google AI Studio. The key
            is stored on this device only.
          </p>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant={mode === "summarize" ? "default" : "outline"}
          onClick={() => setMode("summarize")}
        >
          Summarize
        </Button>
        <Button
          size="sm"
          variant={mode === "ask" ? "default" : "outline"}
          onClick={() => setMode("ask")}
        >
          Ask this book
        </Button>
      </div>

      {mode === "ask" && (
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What did I write about in April?"
          className="mt-3 min-h-20"
        />
      )}

      <Button onClick={run} disabled={busy} className="mt-3 w-full gap-1.5">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        {mode === "summarize" ? "Summarize this book" : "Ask"}
      </Button>

      {answer && (
        <div className="mt-4 rounded-lg border bg-muted/40 p-3 text-sm leading-6">
          {answer}
        </div>
      )}
    </div>
  );
}

/**
 * Gemini Note Refinement Preview & Processing Modal.
 *
 * Provides:
 * 1. A polished, Gemini-themed processing animation communicating refinement progress.
 * 2. An editor comparison preview displaying "CURRENT NOTE" vs "REFINED NOTE" side-by-side
 *    on desktop and stacked on smaller screens.
 * 3. Strict user-driven Accept and Decline actions, guaranteeing the original note is
 *    never modified without explicit user consent.
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Sparkles, X } from "lucide-react";

interface RefinementPreviewProps {
  open: boolean;
  isRefining: boolean;
  originalText: string;
  refinedText: string;
  onAccept: () => void;
  onDecline: () => void;
}

export function RefinementPreview({
  open,
  isRefining,
  originalText,
  refinedText,
  onAccept,
  onDecline,
}: RefinementPreviewProps) {
  if (!open && !isRefining) return null;

  return (
    <Dialog
      open={open || isRefining}
      onOpenChange={(isOpen) => {
        if (!isOpen && !isRefining) {
          onDecline();
        }
      }}
    >
      <DialogContent
        className="max-h-[90vh] w-[95vw] max-w-4xl flex flex-col p-6 sm:p-7 overflow-hidden"
        showCloseButton={!isRefining}
      >
        {isRefining ? (
          /* Processing State with subtle, polished Gemini animation */
          <div
            className="flex flex-col items-center justify-center py-12 px-4 text-center space-y-4"
            role="status"
            aria-live="polite"
          >
            <div className="relative flex size-16 items-center justify-center">
              <div className="absolute inset-0 rounded-2xl bg-primary/20 animate-ping opacity-30" />
              <div className="relative flex size-16 items-center justify-center rounded-2xl border border-primary/40 bg-primary/10 shadow-lg text-primary">
                <Sparkles className="size-8 animate-pulse text-primary" />
              </div>
            </div>

            <div className="space-y-1.5">
              <h3 className="text-lg font-semibold tracking-tight text-foreground">
                Gemini is refining your note…
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Improving clarity, grammar and flow while strictly preserving your meaning.
              </p>
            </div>
          </div>
        ) : (
          /* Comparison Preview State */
          <>
            <DialogHeader className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
                  <Sparkles className="size-4" />
                </div>
                <DialogTitle className="text-xl font-semibold tracking-tight">
                  Gemini Refinement Preview
                </DialogTitle>
              </div>
              <DialogDescription className="text-xs text-muted-foreground">
                Compare the proposed refinement with your original note. Your original note remains untouched until you accept.
              </DialogDescription>
            </DialogHeader>

            {/* Comparison panels */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-0 overflow-hidden">
              {/* Original Note Column */}
              <div className="flex flex-col rounded-lg border border-border/70 bg-muted/20 overflow-hidden">
                <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-3.5 py-2">
                  <span className="font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Original Note
                  </span>
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {countWords(originalText)} words
                  </span>
                </div>
                <div className="flex-1 p-4 overflow-y-auto max-h-[45vh] text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed select-text font-serif">
                  {originalText || "(Empty note)"}
                </div>
              </div>

              {/* Refined Note Column */}
              <div className="flex flex-col rounded-lg border border-primary/40 bg-primary/[0.03] overflow-hidden ring-1 ring-primary/20">
                <div className="flex items-center justify-between border-b border-primary/20 bg-primary/10 px-3.5 py-2">
                  <span className="font-mono text-xs font-semibold uppercase tracking-wider text-primary">
                    ✨ Refined Note
                  </span>
                  <span className="text-[11px] font-mono text-primary/80">
                    {countWords(refinedText)} words
                  </span>
                </div>
                <div className="flex-1 p-4 overflow-y-auto max-h-[45vh] text-sm text-foreground whitespace-pre-wrap leading-relaxed select-text font-serif">
                  {refinedText}
                </div>
              </div>
            </div>

            {/* Actions */}
            <DialogFooter className="mt-6 flex flex-row items-center justify-end gap-2.5 sm:gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onDecline}
                className="gap-1.5 font-medium"
                aria-label="Decline refined note and keep original"
              >
                <X className="size-4" />
                Decline
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={onAccept}
                className="gap-1.5 font-medium"
                aria-label="Accept refined note and update editor"
              >
                <Check className="size-4" />
                Accept Refinement
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function countWords(text: string): number {
  return (text || "").trim().split(/\s+/).filter(Boolean).length;
}

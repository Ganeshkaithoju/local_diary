/**
 * PageStylePicker — the single control for a book's interior paper.
 *
 * Used in four places (create-book dialog, edit book details, the reader's
 * "Paper" quick switch and the writer's toolbar) so the swatches, the custom
 * page-image upload and its drag & drop behaviour exist in exactly one place.
 *
 * Swatches are drawn at the real pattern scale on a page-proportioned card,
 * so what you pick is what you get on the sheet — the previous 36px chips
 * were smaller than the pattern's own repeat and read as blank.
 */
import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { resizePageImageToDataUrl } from "@/diary/coverImage";
import {
  PAGE_STYLES,
  PAGE_STYLE_CLASS,
  PAGE_STYLE_LABELS,
  type PageStyle,
} from "@/diary/types";
import { cn } from "@/lib/utils";

export interface PageStylePickerProps {
  value: PageStyle;
  pageImage: string | null;
  onChange: (style: PageStyle) => void;
  /** `null` removes the custom page image. */
  onPickImage: (dataUrl: string | null) => void;
  /** Tighter grid for popovers and toolbars. */
  compact?: boolean;
  className?: string;
}

export function PageStylePicker({
  value,
  pageImage,
  onChange,
  onPickImage,
  compact = false,
  className,
}: PageStylePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonsRef = useRef<Record<string, HTMLButtonElement | null>>({});
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);

  const acceptFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      const dataUrl = await resizePageImageToDataUrl(file);
      if (!dataUrl) {
        toast.error(
          "That image could not be used. Try a JPG, PNG, or WebP under 12 MB.",
        );
        return;
      }
      onPickImage(dataUrl);
      onChange("custom");
      toast.success("Your page image is set — every page now uses it.");
    } finally {
      setReading(false);
    }
  };

  /** Arrow-key navigation across a radiogroup. */
  const move = (dir: 1 | -1) => {
    const current = PAGE_STYLES.indexOf(value);
    const next =
      PAGE_STYLES[(current + dir + PAGE_STYLES.length) % PAGE_STYLES.length];
    onChange(next);
    buttonsRef.current[next]?.focus();
  };

  return (
    <div className={cn("grid gap-2", className)}>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          void acceptFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <div
        role="radiogroup"
        aria-label="Page style"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            e.preventDefault();
            move(1);
          } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
            e.preventDefault();
            move(-1);
          }
        }}
        className={cn(
          "grid gap-2",
          compact ? "grid-cols-3" : "grid-cols-3 sm:grid-cols-6",
        )}
      >
        {PAGE_STYLES.map((style) => {
          const selected = value === style;
          const isCustom = style === "custom";
          return (
            <button
              key={style}
              ref={(el) => {
                buttonsRef.current[style] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                if (isCustom && !pageImage) {
                  inputRef.current?.click();
                  return;
                }
                onChange(style);
              }}
              onDragOver={(e) => {
                if (!isCustom) return;
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                if (!isCustom) return;
                e.preventDefault();
                setDragging(false);
                void acceptFile(e.dataTransfer.files?.[0]);
              }}
              className={cn(
                "group flex flex-col items-center gap-1.5 rounded-lg border-2 p-1.5 transition-colors",
                selected
                  ? "border-primary ring-2 ring-ring/40"
                  : "border-border hover:border-muted-foreground/40",
              )}
            >
              {/* The paper itself — the same pattern class the book uses. */}
              <span
                className={cn(
                  "relative block aspect-[3/4] w-full overflow-hidden rounded-sm border border-ink/20 bg-paper",
                  style !== "custom" && PAGE_STYLE_CLASS[style],
                )}
                style={
                  isCustom && pageImage
                    ? {
                        backgroundImage: `url(${pageImage})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }
                    : undefined
                }
              >
                {isCustom && !pageImage && (
                  <span
                    className={cn(
                      "absolute inset-0 flex flex-col items-center justify-center gap-1 border border-dashed border-ink/30 text-[9px] leading-tight text-ink-soft",
                      dragging && "border-primary bg-primary/10",
                    )}
                  >
                    {reading ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ImagePlus className="size-3.5" />
                    )}
                    <span className="px-0.5 text-center">
                      {dragging ? "Drop image" : "Upload"}
                    </span>
                  </span>
                )}
                {isCustom && pageImage && selected && (
                  <span className="absolute inset-x-0 bottom-0 bg-primary/85 py-0.5 text-center text-[8px] font-medium uppercase tracking-wider text-primary-foreground">
                    Yours
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "text-[10px] leading-tight",
                  selected ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {PAGE_STYLE_LABELS[style]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Custom image actions */}
      {pageImage && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Your page image is saved with this book.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-3.5" />
            Replace
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive"
            onClick={() => {
              onPickImage(null);
              if (value === "custom") onChange("lined");
              toast.success("Custom page image removed.");
            }}
          >
            <Trash2 className="size-3.5" />
            Remove
          </Button>
        </div>
      )}

      {compact && !pageImage && (
        <p className="text-[11px] leading-4 text-muted-foreground">
          Pick the paper. “Your image” lets you upload a page background — drag
          it onto the card or click to browse.
        </p>
      )}
    </div>
  );
}

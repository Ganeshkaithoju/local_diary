/**
 * CoverUploadDialog — "Add your own cover page".
 *
 * Shown right after a book is created (and reachable from the book detail
 * sidebar). Supports drag & drop plus file browsing. When a custom image is
 * saved, the cover renders ONLY that image — title/subtitle/author are not
 * overlaid anywhere.
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ImageUp, Trash2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { resizeImageToDataUrl } from "@/diary/coverImage";
import { useDiaryStorage } from "@/hooks/use-diary-storage";
import type { DiaryBookMeta } from "@/diary/types";
import { cn } from "@/lib/utils";

interface CoverUploadDialogProps {
  book: DiaryBookMeta;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the cover is saved or removed, with the updated book. */
  onSaved?: (book: DiaryBookMeta) => void;
}

export function CoverUploadDialog({
  book,
  open,
  onOpenChange,
  onSaved,
}: CoverUploadDialogProps) {
  const storage = useDiaryStorage();
  /** undefined = unchanged, null = removed, string = new image data URL. */
  const [preview, setPreview] = useState<string | null | undefined>(undefined);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayed = preview === undefined ? book.coverImage : preview;

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    const dataUrl = await resizeImageToDataUrl(file);
    if (!dataUrl) {
      toast.error(
        "That image could not be used. Try a JPG, PNG, or WebP under 12 MB.",
      );
      return;
    }
    setPreview(dataUrl);
  };

  const save = async (coverImage: string | null) => {
    setBusy(true);
    try {
      await storage.updateBook(book.id, { coverImage });
      toast.success(
        coverImage
          ? "Your cover image is set — the cover shows only your image."
          : "Custom cover removed.",
      );
      onSaved?.({ ...book, coverImage });
      onOpenChange(false);
    } catch {
      toast.error("Could not save the cover. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add your own cover page</DialogTitle>
          <DialogDescription>
            “{book.title}” is ready. Upload a cover from this device — once you
            do, the cover shows only your image, with no text over it.
          </DialogDescription>
        </DialogHeader>

        <div
          role="button"
          tabIndex={0}
          aria-label="Upload cover image"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            void handleFile(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "flex min-h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-center transition-colors",
            dragActive
              ? "border-primary bg-primary/5"
              : "border-border hover:border-muted-foreground/40",
          )}
        >
          {displayed ? (
            <img
              src={displayed}
              alt="Cover preview"
              className="max-h-40 rounded-md object-contain shadow"
            />
          ) : (
            <UploadCloud className="size-8 text-muted-foreground" />
          )}
          <p className="text-sm font-medium">
            {displayed ? "Replace image" : "Drag & drop an image, or click to browse"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            JPG, PNG or WebP from your laptop or phone — resized automatically
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        <DialogFooter className="items-center gap-2">
          {displayed && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => setPreview(null)}
            >
              <Trash2 className="size-3.5" />
              Remove image
            </Button>
          )}
          <div className="flex flex-1 justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Skip for now
            </Button>
            <Button
              disabled={preview === undefined || busy}
              onClick={() => void save(preview as string | null)}
              className="gap-1.5"
            >
              <ImageUp className="size-4" />
              Save cover
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

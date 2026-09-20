/**
 * BookCover — renders a book's cover as a tactile object.
 *
 * When a custom cover image is set, the cover is the image alone: all book
 * details (title, subtitle, author, branding) are suppressed so nothing
 * overlaps the user's artwork. Otherwise the leather-style cover with
 * debossed details renders.
 */
import type { CoverStyle, DiaryBookMeta } from "@/diary/types";
import { cn } from "@/lib/utils";

/** Gradient background for each cover style (also used by style pickers). */
export function coverSwatch(style: CoverStyle): string {
  switch (style) {
    case "ink":
      return "linear-gradient(135deg, #2b2d42 0%, #3d4266 100%)";
    case "forest":
      return "linear-gradient(135deg, #1b3a2f 0%, #2d5a44 100%)";
    case "ocean":
      return "linear-gradient(135deg, #14324f 0%, #2563eb 60%, #3b82f6 100%)";
    case "wine":
      return "linear-gradient(135deg, #4a1530 0%, #7a2347 100%)";
    case "sand":
      return "linear-gradient(135deg, #b89b6e 0%, #d9c9a3 100%)";
    case "midnight":
      return "linear-gradient(135deg, #0f172a 0%, #312e81 100%)";
  }
}

export function BookCover({
  book,
  className,
}: {
  book: DiaryBookMeta;
  className?: string;
}) {
  if (book.coverImage) {
    return (
      <div className={cn("relative overflow-hidden", className)}>
        <img
          src={book.coverImage}
          alt={`Cover of ${book.title}`}
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex flex-col justify-between overflow-hidden rounded-r-lg rounded-l-sm p-4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]",
        className,
      )}
      style={{ background: coverSwatch(book.coverStyle) }}
    >
      {/* Leather grain */}
      <div
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{
          backgroundImage:
            "repeating-linear-gradient(115deg, rgba(255,255,255,0.06) 0 2px, transparent 2px 6px)",
        }}
      />
      {/* Spine highlight */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-3 bg-black/25" />
      <div className="pointer-events-none absolute inset-y-0 left-3 w-px bg-white/15" />
      {/* Foil title */}
      <div className="relative">
        <p className="text-[10px] uppercase tracking-[0.28em] text-white/60">
          Local Diary Core
        </p>
        <h3 className="mt-1 text-lg font-semibold leading-tight drop-shadow-sm">
          {book.title}
        </h3>
      </div>
      <div className="relative">
        {book.subtitle && (
          <p className="line-clamp-2 text-xs text-white/70">{book.subtitle}</p>
        )}
        {book.author && (
          <p className="mt-1 text-xs italic text-white/60">by {book.author}</p>
        )}
      </div>
    </div>
  );
}

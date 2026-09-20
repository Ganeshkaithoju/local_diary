/**
 * PageFlipReader — the defining Local Diary Core experience.
 *
 * A physical book: cover → contents → diary pages → back cover, turned with
 * the real page-flip animation from `react-pageflip` / `page-flip` (page curl,
 * corner fold, cast shadows). There is no static slide/swap effect: the sheet
 * physically turns from right to left on the next page, and from left to right
 * on the previous page, exactly like paper.
 *
 * Full screen reading mode: hides all chrome (top/bottom bars) and requests
 * the browser Fullscreen API so the browser taskbar/URL bar disappears too
 * (works in Chrome desktop and Android). A slim exit button and Esc both
 * leave reading mode; leaving native fullscreen also exits reading mode.
 *
 * Numbering: entry pages only — cover, contents and back cover are
 * structural pages with no printed number.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { motion } from "framer-motion";
import HTMLFlipBook from "react-pageflip";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  List,
  Loader2,
  Maximize,
  Minimize,
  Palette,
  Pencil,
  Printer,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PageStylePicker } from "@/features/library/PageStylePicker";
import { downloadBookPdf, printCurrentPage } from "@/diary/bookExport";
import {
  computeLayout,
  splitEntryPages,
  entryPageCapacity,
  CONTENTS_ROWS_PER_PAGE,
  PAGE_ASPECT,
  PAGE_MAX_WIDTH,
  PAGE_MIN_WIDTH,
  type BookLayout,
  type DiaryPage,
} from "@/diary/pagination";
import {
  PAGE_STYLE_CLASS,
  effectivePageStyle,
  type DiaryBookMeta,
  type DiaryEntry,
  type PageStyle,
} from "@/diary/types";
import { cn } from "@/lib/utils";

interface PageFlipReaderProps {
  book: DiaryBookMeta;
  entries: DiaryEntry[];
  onEditEntry: (entryId: string) => void;
  onClose: () => void;
  /** Persist a paper change made from inside the reader. */
  onChangePageStyle?: (patch: {
    pageStyle?: PageStyle;
    pageImage?: string | null;
  }) => void;
}

/** Page-flip duration (ms) — the real paper turn. */
const FLIP_TIME = 700;
/** Printed spread ratio used to size the book inside the viewport. */
const SPREAD_RATIO = 1.483;
/** Text metrics the entry sheets are designed around (`text-[15px] leading-8`). */
const BODY_FONT = 15;
const BODY_LINE = 32;
/**
 * How far the safety net may squeeze a page before it gives up. Pagination is
 * sized from the real sheet, so this only ever absorbs small rounding — but it
 * exists so a line can never be pushed off the bottom edge and lost.
 */
const MIN_FIT = 0.62;
/**
 * How many sheets a contents jump is willing to turn one at a time. Beyond
 * this the reader makes up the distance first, so a distant entry does not
 * mean waiting through dozens of flips.
 */
const MAX_TRAVEL_SHEETS = 6;

/** The imperative surface react-pageflip exposes through its ref. */
interface FlipController {
  flipNext: (corner?: "top" | "bottom") => void;
  flipPrev: (corner?: "top" | "bottom") => void;
  turnToPage: (page: number) => void;
  getCurrentPageIndex: () => number;
}

export function PageFlipReader({
  book,
  entries,
  onEditEntry,
  onClose,
  onChangePageStyle,
}: PageFlipReaderProps) {
  /**
   * Page capacity follows the viewport: the same book shows a 300px-wide sheet
   * on a phone and a 620px-wide one on a desktop, so how much writing fits on
   * a page changes with the window (and with phone rotation). Pagination is
   * recomputed from that, which is why the layout remounts the book when the
   * size steps — the alternative, a fixed guess, clips writing.
   */
  const viewport = useViewportSize();
  const capacity = useMemo(() => entryPageCapacity(viewport), [viewport]);
  /** Continuation pages drop the entry header, so they hold more writing. */
  const continuationCapacity = useMemo(
    () => entryPageCapacity(viewport, { withHeader: false }),
    [viewport],
  );
  const layout: BookLayout = useMemo(
    () => computeLayout(entries, capacity, continuationCapacity),
    [entries, capacity, continuationCapacity],
  );
  const [index, setIndex] = useState(0); // index into layout.pages
  const [flipping, setFlipping] = useState(false);
  /**
   * True while the book shows two facing pages (landscape). The stitched
   * spine only makes sense between two facing pages, and the spread also
   * decides what "print this page" means. The initial value mirrors the flip
   * engine's own rule (it falls back to a single page under ~600px) so the
   * spine never flashes on a phone before the first orientation event.
   */
  const [spread, setSpread] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 700,
  );
  const [readingMode, setReadingMode] = useState(false);
  const [busyPdf, setBusyPdf] = useState(false);
  const [pdfMessage, setPdfMessage] = useState("");
  const flipRef = useRef<{ pageFlip: () => FlipController | null } | null>(null);
  /** Orientation reported by the flip engine (decides pages per spread). */
  const orientationRef = useRef<"portrait" | "landscape">("landscape");
  /** Page index the book is currently travelling to, if any. */
  const travelRef = useRef<number | null>(null);
  const travelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reducedMotion = useReducedMotionPref();

  const total = layout.pages.length;
  const safeIndex = Math.min(Math.max(index, 0), Math.max(total - 1, 0));
  const page: DiaryPage = layout.pages[safeIndex];
  /**
   * The pages actually on screen. In a landscape spread that is the current
   * page plus the one facing it; the cover and the back cover are shown on
   * their own, so they are never paired with a blank half.
   */
  const visiblePages = useMemo(() => {
    const current = layout.pages[safeIndex];
    if (!current) return [];
    const facing =
      spread && safeIndex > 0 ? layout.pages[safeIndex + 1] : undefined;
    return facing ? [current, facing] : [current];
  }, [layout, safeIndex, spread]);
  const activeEntryCount = useMemo(
    () => entries.filter((e) => !e.deletedAt).length,
    [entries],
  );
  /** The style actually rendered: `custom` without an image falls back. */
  const style = effectivePageStyle(book);
  const pageStyleClass = PAGE_STYLE_CLASS[style] ?? "page-lined";
  const customPageImage = style === "custom" ? book.pageImage : null;

  /**
   * Remount the flip book only when the book itself changes shape (pages
   * added/removed, style or cover changed). This keeps the library's page
   * geometry accurate instead of re-measuring on every re-render.
   */
  const bookKey = `${book.id}:${style}:${book.pageImage ? "pimg" : "none"}:${book.coverImage ? "img" : "styled"}:${total}:${layout.contentsPageCount}`;

  const controller = useCallback(() => flipRef.current?.pageFlip() ?? null, []);

  // ------------------------------------------------------------- navigation
  const go = useCallback(
    (dir: 1 | -1) => {
      const flip = controller();
      if (!flip || flipping) return;
      // A manual turn cancels any contents jump still in flight.
      travelRef.current = null;
      if (dir === 1) flip.flipNext();
      else flip.flipPrev();
    },
    [controller, flipping],
  );

  /** True when the wanted page is one of the pages on screen right now. */
  const isTargetVisible = useCallback((current: number, target: number) => {
    if (orientationRef.current === "portrait") return current === target;
    // A landscape spread shows two consecutive pages side by side.
    return current === target || current + 1 === target;
  }, []);

  /** One sheet of a contents jump — chained from the previous flip. */
  const stepTravel = useCallback(() => {
    const flip = controller();
    const target = travelRef.current;
    if (!flip || target === null) return;
    const current = flip.getCurrentPageIndex();
    if (isTargetVisible(current, target)) {
      travelRef.current = null;
      return;
    }
    if (target > current) flip.flipNext();
    else flip.flipPrev();
  }, [controller, isTargetVisible]);

  const scheduleTravel = useCallback(() => {
    if (travelTimerRef.current) clearTimeout(travelTimerRef.current);
    travelTimerRef.current = setTimeout(() => stepTravel(), 60);
  }, [stepTravel]);

  /**
   * Turn the book to a page using the real flip animation. Nearby targets are
   * flipped sheet by sheet, so the reader watches the pages turn; a very long
   * jump covers most of the distance first and animates the last sheets.
   */
  const startTravel = useCallback(
    (target: number) => {
      const flip = controller();
      if (!flip || target < 0 || target >= total) return;
      const current = flip.getCurrentPageIndex();
      if (isTargetVisible(current, target)) return;
      const sheet = orientationRef.current === "portrait" ? 1 : 2;
      if (Math.abs(target - current) > MAX_TRAVEL_SHEETS * sheet) {
        flip.turnToPage(
          target > current ? target - sheet * 2 : target + sheet * 2,
        );
      }
      travelRef.current = target;
      scheduleTravel();
    },
    [controller, isTargetVisible, scheduleTravel, total],
  );

  const goToEntry = useCallback(
    (entryId: string) => {
      const row = layout.contentsRows.find((r) => r.entryId === entryId);
      if (!row) return;
      const target = layout.pages.findIndex((p) => p.number === row.page);
      if (target >= 0) startTravel(target);
    },
    [layout, startTravel],
  );

  const goToContents = useCallback(() => {
    const target = layout.pages.findIndex((p) => p.kind === "contents");
    if (target >= 0) startTravel(target);
  }, [layout, startTravel]);

  // Never leave a pending jump timer behind.
  useEffect(
    () => () => {
      if (travelTimerRef.current) clearTimeout(travelTimerRef.current);
    },
    [],
  );

  // ------------------------------------------------------------ export
  /** Print the cover sheet plus every page currently on screen. */
  const handlePrint = useCallback(() => {
    printCurrentPage({ book, entries, layout, pages: visiblePages });
  }, [book, entries, layout, visiblePages]);

  /** Download the entire diary as a PDF (cover, contents, every entry). */
  const handleDownloadPdf = useCallback(async () => {
    if (busyPdf) return;
    setBusyPdf(true);
    setPdfMessage("Preparing your PDF…");
    try {
      await downloadBookPdf({
        book,
        entries,
        onProgress: (message) => setPdfMessage(message),
      });
      toast.success("Your book was saved as a PDF.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "The PDF could not be created.",
      );
    } finally {
      setBusyPdf(false);
      setPdfMessage("");
    }
  }, [book, entries, busyPdf]);

  // -------------------------------------------------------- full screen mode
  /**
   * True only when reading mode itself entered native full screen. If the app
   * was already full screen (the "open in full screen" workspace setting),
   * leaving reading mode must not drop the user out of it.
   */
  const ownsFullscreenRef = useRef(false);

  const enterFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      ownsFullscreenRef.current = false;
      return;
    }
    const el = document.documentElement;
    const req =
      el.requestFullscreen?.bind(el) ??
      (
        el as unknown as {
          webkitRequestFullscreen?: () => Promise<void>;
        }
      ).webkitRequestFullscreen?.bind(el);
    if (req) {
      void req().then(
        () => {
          ownsFullscreenRef.current = true;
        },
        () => undefined,
      );
    }
  }, []);

  const exitFullscreen = useCallback(() => {
    if (ownsFullscreenRef.current && document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => undefined);
    }
    ownsFullscreenRef.current = false;
  }, []);

  const toggleReadingMode = useCallback(() => {
    setReadingMode((prev) => {
      if (prev) {
        exitFullscreen();
        return false;
      }
      enterFullscreen();
      return true;
    });
  }, [enterFullscreen, exitFullscreen]);

  const exitReadingMode = useCallback(() => {
    setReadingMode(false);
    exitFullscreen();
  }, [exitFullscreen]);

  // If the user leaves native fullscreen by other means (Esc, F11, browser
  // UI), leave reading mode too so the chrome never stays hidden.
  useEffect(() => {
    const onChange = () => {
      if (readingMode && !document.fullscreenElement) setReadingMode(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [readingMode]);

  // Keyboard navigation — the flip book animates the turn itself.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "Escape" && readingMode) {
        e.preventDefault();
        exitReadingMode();
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [go, onClose, readingMode, exitReadingMode]);

  // ---------------------------------------------------------------- render
  const onFlip = useCallback(
    (e: { data: number }) => {
      setIndex(e.data);
      // Keep a contents jump going: each finished sheet starts the next one.
      if (travelRef.current !== null) scheduleTravel();
    },
    [scheduleTravel],
  );

  const onChangeState = useCallback((e: { data: string }) => {
    setFlipping(e.data === "flipping");
  }, []);

  /** Tracks whether the book is showing one page (portrait) or a spread. */
  const onOrientation = useCallback((e: { data: unknown }) => {
    const mode =
      typeof e.data === "string"
        ? e.data
        : (e.data as { mode?: string } | null)?.mode;
    if (mode === "portrait" || mode === "landscape") {
      orientationRef.current = mode;
      setSpread(mode === "landscape");
    }
  }, []);

  const renderPageFace = useCallback(
    (p: DiaryPage) => {
      switch (p.kind) {
        case "cover":
          return <CoverFace book={book} entryCount={activeEntryCount} />;
        case "back-cover":
          return <BackCoverFace book={book} />;
        case "contents":
          return (
            <ContentsFace
              layout={layout}
              contentsIndex={p.contentsIndex ?? 0}
              onJump={goToEntry}
            />
          );
        case "entry": {
          const entry = entries.find((e) => e.id === p.entryId);
          if (!entry) return null;
          const chunks = splitEntryPages(
            entry,
            capacity,
            continuationCapacity,
          );
          const part = chunks[p.partIndex ?? 0] ?? "";
          return (
            <EntryFace
              entry={entry}
              partHtml={part}
              pageNumber={p.number ?? 0}
              partIndex={p.partIndex ?? 0}
            />
          );
        }
      }
    },
    [
      book,
      entries,
      layout,
      activeEntryCount,
      goToEntry,
      capacity,
      continuationCapacity,
    ],
  );

  /**
   * Page children are memoised so their identity stays stable while the reader
   * re-renders (flip state, full screen, PDF progress). A new children array
   * on every render would make react-pageflip re-measure the whole book.
   */
  const bookPages = useMemo(
    () =>
      layout.pages.map((p, i) => {
        const isEntry = p.kind === "entry";
        // A custom page image is painted by a child layer with a soft paper
        // veil above it, so the writing never fights the picture. It must NOT
        // be an inline style on the sheet element — page-flip's renderer
        // rewrites that element's `cssText` when it draws, which wipes it.
        const withImage = isEntry && !!customPageImage;
        return (
          <div
            key={`${p.kind}-${i}-${p.entryId ?? ""}`}
            className={cn(
              "paper relative h-full w-full overflow-hidden",
              isEntry && pageStyleClass,
            )}
          >
            {withImage && (
              <>
                <div
                  className="page-image-layer"
                  style={{ backgroundImage: `url(${customPageImage})` }}
                  aria-hidden
                />
                <div className="page-image-veil absolute inset-0" aria-hidden />
              </>
            )}
            <div className="relative h-full w-full">
              {renderPageFace(p)}
            </div>
          </div>
        );
      }),
    [layout, renderPageFace, pageStyleClass, customPageImage],
  );

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm",
        readingMode && "bg-background",
      )}
    >
      {/* Top bar — hidden in full screen reading mode */}
      {!readingMode && (
        <div className="flex items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close reader"
            >
              <X className="size-5" />
            </Button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{book.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {book.author || "Local Diary Core"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={goToContents}
              className="hidden sm:inline-flex gap-1.5"
            >
              <List className="size-4" />
              Contents
            </Button>
            {/* Change the paper without leaving the book. */}
            {onChangePageStyle && (
              <PaperSwitcher
                style={style}
                pageImage={book.pageImage}
                onChangeStyle={(next) => onChangePageStyle({ pageStyle: next })}
                onChangeImage={(img) => onChangePageStyle({ pageImage: img })}
              />
            )}
            {page?.kind === "entry" && page.entryId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onEditEntry(page.entryId!)}
                className="gap-1.5"
              >
                <Pencil className="size-4" />
                Edit
              </Button>
            )}
            {/* Print the cover + every page on screen */}
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="gap-1.5"
              aria-label="Print this page"
              title="Print the cover and the pages on screen"
            >
              <Printer className="size-4" />
              <span className="hidden sm:inline">Print</span>
            </Button>
            {/* Download the whole diary as a PDF */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleDownloadPdf()}
              disabled={busyPdf}
              className="gap-1.5"
              aria-label="Download the whole book as a PDF"
              title="Download the whole book as a PDF"
            >
              {busyPdf ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              <span className="hidden sm:inline">Download book</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={toggleReadingMode}
              className="gap-1.5"
              aria-label="Enter full screen reading mode"
            >
              <Maximize className="size-4" />
              <span className="hidden sm:inline">Full screen</span>
            </Button>
          </div>
        </div>
      )}

      {/* In reading mode: slim always-available exit controls */}
      {readingMode && (
        <>
          <div className="absolute left-3 top-3 z-20">
            <Button
              variant="outline"
              size="sm"
              onClick={exitReadingMode}
              className="gap-1.5 bg-background/80 backdrop-blur"
            >
              <ArrowLeft className="size-4" />
              Exit
            </Button>
          </div>
          <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
            {onChangePageStyle && (
              <PaperSwitcher
                style={style}
                pageImage={book.pageImage}
                onChangeStyle={(next) => onChangePageStyle({ pageStyle: next })}
                onChangeImage={(img) => onChangePageStyle({ pageImage: img })}
                iconOnly
              />
            )}
            <Button
              variant="outline"
              size="icon"
              onClick={handlePrint}
              aria-label="Print this page"
              title="Print the cover and this page"
              className="bg-background/80 backdrop-blur"
            >
              <Printer className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => void handleDownloadPdf()}
              disabled={busyPdf}
              aria-label="Download the whole book as a PDF"
              title="Download the whole book as a PDF"
              className="bg-background/80 backdrop-blur"
            >
              {busyPdf ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={exitReadingMode}
              aria-label="Exit full screen"
              className="bg-background/80 backdrop-blur"
            >
              <Minimize className="size-4" />
            </Button>
          </div>
        </>
      )}

      {/* Book area */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden px-3 pb-6 select-none">
        {/* Click zones outside the book edges */}
        <button
          className="absolute left-0 top-0 z-10 h-full w-[14%] cursor-w-resize"
          onClick={() => go(-1)}
          aria-label="Previous page"
        />
        <button
          className="absolute right-0 top-0 z-10 h-full w-[14%] cursor-e-resize"
          onClick={() => go(1)}
          aria-label="Next page"
        />

        {/* Animated page-turn indicators — nudge toward the flip zones.
            They slide toward the turning direction and disappear when the
            edge of the book is reached. */}
        {safeIndex > 0 && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute left-[2%] top-1/2 z-20 hidden -translate-y-1/2 sm:block"
            animate={{ x: [0, -8, 0], opacity: [0.45, 0.9, 0.45] }}
            transition={{
              duration: 1.6,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            <ArrowLeft className="size-7 text-primary drop-shadow-md" />
          </motion.div>
        )}
        {safeIndex < total - 1 && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute right-[2%] top-1/2 z-20 hidden -translate-y-1/2 sm:block"
            animate={{ x: [0, 8, 0], opacity: [0.45, 0.9, 0.45] }}
            transition={{
              duration: 1.6,
              repeat: Infinity,
              ease: "easeInOut",
              delay: 0.8,
            }}
          >
            <ArrowRight className="size-7 text-primary drop-shadow-md" />
          </motion.div>
        )}

        {/* The book itself. The wrapper caps the width from the viewport
            height so the printed spread always fits without clipping. */}
        <div
          className="relative mx-auto w-full"
          style={{
            maxWidth: `min(100%, calc((100dvh - 12rem) * ${SPREAD_RATIO}))`,
          }}
        >
          <HTMLFlipBook
            key={bookKey}
            ref={flipRef}
            className="diary-flipbook"
            style={{}}
            startPage={safeIndex}
            size="stretch"
            width={430}
            height={580}
            minWidth={PAGE_MIN_WIDTH}
            maxWidth={PAGE_MAX_WIDTH}
            minHeight={Math.round(PAGE_MIN_WIDTH * PAGE_ASPECT)}
            maxHeight={Math.round(PAGE_MAX_WIDTH * PAGE_ASPECT)}
            drawShadow={true}
            flippingTime={reducedMotion ? 1 : FLIP_TIME}
            usePortrait={true}
            startZIndex={0}
            autoSize={true}
            maxShadowOpacity={0.5}
            showCover={true}
            mobileScrollSupport={true}
            /* true = clicks on buttons/links inside a page stay button
               clicks and never start a page turn (contents links jump). */
            clickEventForward={true}
            useMouseEvents={true}
            swipeDistance={30}
            showPageCorners={true}
            disableFlipByClick={false}
            onFlip={onFlip}
            onChangeState={onChangeState}
            onInit={onOrientation}
            onChangeOrientation={onOrientation}
          >
            {bookPages}
          </HTMLFlipBook>

          {/* The sewn binding down the gutter — only between two facing
              pages, so the reader always knows where the left page ends and
              the right one begins. It is hidden for the duration of a turn:
              the sheet being lifted has to pass over the fold freely, and it
              only reappears once the book has settled again. */}
          {visiblePages.length === 2 && !flipping && (
            <div className="book-spine" aria-hidden />
          )}
        </div>

        {/* PDF build status — the whole-book export blocks briefly. */}
        {busyPdf && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-background/90 px-4 py-1.5 text-xs text-muted-foreground backdrop-blur">
            <Loader2 className="size-3 animate-spin" />
            {pdfMessage || "Preparing your PDF…"}
          </div>
        )}
      </div>

      {/* Bottom bar — hidden in full screen reading mode */}
      {!readingMode && (
        <div className="flex items-center justify-between px-4 pb-5 sm:px-8">
          <Button
            variant="outline"
            size="icon"
            onClick={() => go(-1)}
            disabled={safeIndex === 0}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-5" />
          </Button>
          <div className="text-center">
            <p className="text-sm font-medium tabular-nums">
              {page?.kind === "cover"
                ? "Cover"
                : page?.kind === "contents"
                  ? "Contents"
                  : page?.kind === "back-cover"
                    ? "The end"
                    : (page?.number ?? "")}
            </p>
            <p className="text-xs text-muted-foreground">
              {page?.kind === "cover"
                ? "Open the book"
                : page?.kind === "contents"
                  ? layout.contentsPageCount > 1
                    ? `${(page.contentsIndex ?? 0) + 1} of ${layout.contentsPageCount}`
                    : "What's inside"
                  : page?.kind === "back-cover"
                    ? "Back cover"
                    : (page?.totalParts ?? 1) > 1
                      ? `Page ${page?.number ?? ""} · part ${(page?.partIndex ?? 0) + 1} of ${page?.totalParts}`
                      : `Page ${page?.number ?? ""}`}
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => go(1)}
            disabled={safeIndex >= total - 1}
            aria-label="Next page"
          >
            <ChevronRight className="size-5" />
          </Button>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- faces -- */

function CoverFace({
  book,
  entryCount,
}: {
  book: DiaryBookMeta;
  entryCount: number;
}) {
  // Custom cover image: the artwork stands alone — no text overlay.
  if (book.coverImage) {
    return (
      <img
        src={book.coverImage}
        alt={`Cover of ${book.title}`}
        className="h-full w-full object-cover"
        draggable={false}
      />
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-10 text-center">
      <p className="text-xs uppercase tracking-[0.3em] text-ink-soft">
        {entryCount} memories
      </p>
      <h1 className="text-4xl font-semibold tracking-tight text-ink">
        {book.title}
      </h1>
      {book.subtitle && (
        <p className="max-w-xs text-base text-ink-soft">{book.subtitle}</p>
      )}
      <div className="mt-6 h-px w-24 bg-ink/20" />
      <p className="mt-2 text-sm italic text-ink-soft">
        {book.author ? `by ${book.author}` : "a private diary"}
      </p>
    </div>
  );
}

function BackCoverFace({ book }: { book: DiaryBookMeta }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
      <BookOpen className="size-8 text-ink-soft" />
      <p className="text-sm italic text-ink-soft">
        {book.title} — every page you write keeps a memory alive.
      </p>
    </div>
  );
}

function ContentsFace({
  layout,
  contentsIndex,
  onJump,
}: {
  layout: BookLayout;
  contentsIndex: number;
  onJump: (entryId: string) => void;
}) {
  const start = contentsIndex * CONTENTS_ROWS_PER_PAGE;
  const rows = layout.contentsRows.slice(
    start,
    start + CONTENTS_ROWS_PER_PAGE,
  );
  return (
    <div className="flex h-full flex-col p-6 sm:p-10">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold text-ink sm:text-2xl">Contents</h2>
        <span className="text-xs text-ink-soft">
          {layout.contentsPageCount > 1
            ? `${contentsIndex + 1} / ${layout.contentsPageCount}`
            : undefined}
        </span>
      </div>
      <div className="mt-2 h-px w-full bg-ink/15" />
      <ol className="mt-3 flex-1 space-y-1 overflow-hidden sm:mt-4 sm:space-y-2">
        {rows.length === 0 && (
          <li className="text-sm italic text-ink-soft">
            No entries yet — write your first page.
          </li>
        )}
        {rows.map((row) => (
          <li key={row.entryId}>
            <button
              onClick={() => onJump(row.entryId)}
              className="group flex w-full items-baseline gap-2 text-left"
            >
              {/* pointer-events-none keeps the row button itself as the click
                  target, so the flip engine never turns a page instead. */}
              <span className="pointer-events-none min-w-0 flex-shrink truncate text-[13px] font-medium text-ink transition-colors group-hover:text-primary sm:text-sm">
                {row.title}
              </span>
              <span className="pointer-events-none flex-1 border-b border-dotted border-ink/25" />
              <span className="pointer-events-none shrink-0 text-[13px] tabular-nums text-ink-soft sm:text-sm">
                {row.page}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {layout.contentsPageCount > 1 && (
        <p className="mt-2 text-center text-[11px] text-ink-soft sm:mt-3 sm:text-xs">
          {(contentsIndex + 1) * CONTENTS_ROWS_PER_PAGE + 1}–
          {Math.min(
            (contentsIndex + 1) * CONTENTS_ROWS_PER_PAGE,
            layout.contentsRows.length,
          )}{" "}
          of {layout.contentsRows.length} entries
        </p>
      )}
    </div>
  );
}

/**
 * The page's paper pattern lives on the sheet wrapper (see `bookPages`), so
 * the face stays a plain content layer — that keeps the ruling aligned to the
 * page edge instead of being inset by this component's padding.
 */
function EntryFace({
  entry,
  partHtml,
  pageNumber,
  partIndex,
}: {
  entry: DiaryEntry;
  partHtml: string;
  pageNumber: number;
  partIndex: number;
}) {
  // Safety net: if a part still overflows the sheet, squeeze the type until
  // every line is on the page. Nothing may be clipped — a lost line is a lost
  // memory.
  const bodyRef = useRef<HTMLDivElement>(null);
  useFitToPage(bodyRef, partHtml);
  return (
    <div className="flex h-full flex-col p-8 sm:p-12">
      {partIndex === 0 && (
        <header className="mb-4">
          <p className="text-xs uppercase tracking-[0.25em] text-ink-soft">
            {entry.date}
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-ink">
            {entry.title || "Untitled"}
          </h2>
          {entry.mood && (
            <p className="mt-1 text-sm italic text-ink-soft">{entry.mood}</p>
          )}
          <div className="mt-3 h-px w-16 bg-ink/20" />
        </header>
      )}
      <div
        ref={bodyRef}
        className="diary-content flex-1 overflow-hidden text-[15px] leading-8 text-ink"
        dangerouslySetInnerHTML={{ __html: partHtml }}
      />
      {/* Only the printed page number — the "1 / 1" part counter was noise. */}
      <footer className="mt-3 flex items-center justify-end text-xs text-ink-soft">
        <span className="tabular-nums">{pageNumber || ""}</span>
      </footer>
    </div>
  );
}

/** Paper quick switch — the same picker the dialogs use, in a popover. */
function PaperSwitcher({
  style,
  pageImage,
  onChangeStyle,
  onChangeImage,
  iconOnly = false,
}: {
  style: PageStyle;
  pageImage: string | null;
  onChangeStyle: (style: PageStyle) => void;
  onChangeImage: (image: string | null) => void;
  iconOnly?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        {iconOnly ? (
          <Button
            variant="outline"
            size="icon"
            className="bg-background/80 backdrop-blur"
            aria-label="Change page style"
            title="Change the paper"
          >
            <Palette className="size-4" />
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            aria-label="Change page style"
          >
            <Palette className="size-4" />
            <span className="hidden sm:inline">Paper</span>
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[19rem]">
        <p className="text-sm font-medium">Page style</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Changes the paper on every page of this book.
        </p>
        <PageStylePicker
          value={style}
          pageImage={pageImage}
          onChange={onChangeStyle}
          onPickImage={onChangeImage}
          compact
          className="mt-3"
        />
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------- helpers -- */

/**
 * Keep a page of writing inside its sheet.
 *
 * Pagination is already sized from the real sheet, so this only has to absorb
 * the last few percent — a rounding error, an unusually long word, a font that
 * renders wider than expected. When a part does overflow, the body text is
 * stepped down until the whole thing is visible instead of being clipped by
 * the sheet's `overflow: hidden`.
 *
 * Pages the flip engine is keeping hidden have no box yet (they are
 * `display: none`), so the measurement is skipped and repeated by the
 * ResizeObserver the moment the page is actually shown.
 */
function useFitToPage(
  ref: RefObject<HTMLDivElement | null>,
  content: string,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;

    const fit = () => {
      // Always measure from the design size so re-fitting never stacks up.
      el.style.fontSize = "";
      el.style.lineHeight = "";
      const available = el.clientHeight;
      if (available <= 0) return;

      let scale = 1;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const needed = el.scrollHeight;
        if (needed <= available) return; // the whole part is on the page
        // Laid-out height falls with roughly the square of the text scale
        // (smaller type re-wraps into fewer, shorter lines), so take the root.
        scale = Math.max(MIN_FIT, scale * Math.sqrt(available / needed) * 0.98);
        el.style.fontSize = `${BODY_FONT * scale}px`;
        el.style.lineHeight = `${BODY_LINE * scale}px`;
        if (scale <= MIN_FIT) return;
      }
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };

    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    // A late webfont can re-wrap the text (and change how tall it is) without
    // the sheet's own box moving, so measure once more when fonts are ready.
    let cancelled = false;
    if (typeof document !== "undefined" && document.fonts) {
      void document.fonts.ready.then(() => {
        if (!cancelled) schedule();
      });
    }
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [ref, content]);
}

/**
 * Viewport size, debounced. The book (and therefore how much writing fits on
 * a page) is sized from it, so a window resize or a phone rotating has to
 * re-paginate — otherwise the pages would be laid out for the wrong sheet.
 */
function useViewportSize(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({
    width: typeof window === "undefined" ? 1280 : window.innerWidth,
    height: typeof window === "undefined" ? 800 : window.innerHeight,
  }));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setSize((prev) =>
          prev.width === window.innerWidth && prev.height === window.innerHeight
            ? prev
            : { width: window.innerWidth, height: window.innerHeight },
        );
      }, 200);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  return size;
}

function useReducedMotionPref(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

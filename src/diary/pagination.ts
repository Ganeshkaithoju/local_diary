/**
 * Pagination engine — pure functions, no React.
 *
 * Given a book's ordered entries, computes the full physical layout:
 * cover → contents pages → entry pages → back cover.
 *
 * Numbering rule: ONLY entry pages carry printed numbers. The first entry
 * page is page 1; cover, contents and back cover are structural pages with
 * no printed number. Contents rows reference the printed number of the page
 * where each entry starts, computed from the same layout — never hard-coded.
 *
 * Contents pagination: each contents page is filled to capacity (see
 * CONTENTS_ROWS_PER_PAGE) before another one is added right after it, so the
 * contents grow one full page at a time and no page is left half empty.
 * Every row's printed page number is derived from the actual layout.
 */
import type { DiaryEntry } from "./types";

/**
 * Fallback characters-per-page, used only when a caller has no viewport to
 * work from. Real pagination asks `entryPageCapacity` (below) instead: the
 * book stretches from a 300px-wide sheet on a phone to a 620px-wide one on a
 * desktop, so a single hard-coded guess either clips writing on small screens
 * or leaves pages half empty on large ones.
 */
export const CHARS_PER_PAGE = 900;

/* ------------------------------------------------------ page geometry ----
   The reader lays the book out with these numbers (see PageFlipReader), and
   the capacity model below has to agree with them or text gets pushed off the
   sheet. They live here because they are a pagination concern. */

/** Sheet width at its smallest, as `HTMLFlipBook` is configured. */
export const PAGE_MIN_WIDTH = 300;
/** Sheet width at its largest. */
export const PAGE_MAX_WIDTH = 620;
/** A sheet is 430 x 580 — taller than wide, like a real page. */
export const PAGE_ASPECT = 580 / 430;
/** Body text: 15px type on a 32px baseline (`text-[15px] leading-8`). */
const BODY_LINE_HEIGHT = 32;
/** Mean glyph width of Inter at 15px, measured with word spacing. */
const AVG_CHAR_WIDTH = 7.2;
/** Sheet padding is `p-8`, `sm:p-12` above the sm breakpoint. */
const SHEET_PADDING = 32;
const SHEET_PADDING_SM = 48;
const SM_BREAKPOINT = 640;
/** Space the entry header (date, title, mood, rule) and footer page number
 *  take on every entry sheet. */
const ENTRY_HEADER_HEIGHT = 108;
const ENTRY_FOOTER_HEIGHT = 42;
/** Keep a slice of the page spare so a rounding error can never push the last
 *  line past the bottom edge — a clipped line loses a memory. */
const CAPACITY_SAFETY = 0.94;

/**
 * How many characters one entry sheet can show at a given viewport.
 *
 * Mirrors the reader's geometry exactly: the spread is capped by the viewport
 * height, each sheet is a 430:580 rectangle, and the writing area is what is
 * left after the sheet padding, the entry header and the page-number footer.
 */
export function entryPageCapacity(
  viewport: {
    width: number;
    height: number;
  },
  /** Continuation pages have no date/title/mood header, so they hold more. */
  options: { withHeader?: boolean } = {},
): number {
  const withHeader = options.withHeader ?? true;
  const padding = viewport.width >= SM_BREAKPOINT ? SHEET_PADDING_SM : SHEET_PADDING;
  // The book area is the viewport minus the reader's horizontal padding.
  const available = Math.max(PAGE_MIN_WIDTH, viewport.width - 24);
  // The reader caps the spread so it always fits vertically.
  const heightCapped = Math.max(0, (viewport.height - 192) * 1.483);
  const blockWidth = Math.min(available, heightCapped);
  // Under two minimum sheets wide the book shows one page (page-flip's own
  // rule), otherwise two facing pages.
  const portrait = blockWidth < PAGE_MIN_WIDTH * 2;
  const sheetWidth = Math.min(
    Math.max(portrait ? blockWidth : blockWidth / 2, PAGE_MIN_WIDTH),
    PAGE_MAX_WIDTH,
  );

  const sheetHeight = sheetWidth * PAGE_ASPECT;
  const bodyHeight =
    sheetHeight -
    padding * 2 -
    (withHeader ? ENTRY_HEADER_HEIGHT : 0) -
    ENTRY_FOOTER_HEIGHT;
  const lines = Math.floor(bodyHeight / BODY_LINE_HEIGHT);
  const charsPerLine = Math.floor((sheetWidth - padding * 2) / AVG_CHAR_WIDTH);
  return Math.max(120, Math.floor(lines * charsPerLine * CAPACITY_SAFETY));
}

/**
 * Contents rows that fit on a single contents page. Sized so a full page of
 * rows fills the sheet (desktop and mobile) without overflowing it.
 */
export const CONTENTS_ROWS_PER_PAGE = 14;

export type PageKind = "cover" | "contents" | "entry" | "back-cover";

export interface DiaryPage {
  /** 1-based position in the physical page sequence (cover is position 1). */
  index: number;
  kind: PageKind;
  /**
   * Printed page number — entry pages only. Structural pages (cover,
   * contents, back cover) have none and display their kind instead.
   */
  number?: number;
  entryId?: string;
  /** For entry pages: index of this page within the entry (0-based). */
  partIndex?: number;
  totalParts?: number;
  /** For contents pages: index within the contents section (0-based). */
  contentsIndex?: number;
}

export interface ContentsRow {
  entryId: string;
  title: string;
  date: string;
  /** Printed number of the page where this entry starts. */
  page: number;
}

export interface BookLayout {
  pages: DiaryPage[];
  contentsRows: ContentsRow[];
  contentsPageCount: number;
}

/**
 * Split a block that is on its own longer than a page.
 *
 * The cut is made at whitespace that sits OUTSIDE any tag, so a paragraph is
 * never broken mid-markup: slicing raw HTML at a character offset can cut a
 * tag in half, which renders as mangled text and silently loses the words on
 * both sides of the break.
 */
function splitBlockHtml(block: string, size: number): string[] {
  const pieces: string[] = [];
  let rest = block;
  while (rest.length > size) {
    const limit = Math.min(rest.length, size);
    let cut = -1;
    let inTag = false;
    for (let i = 0; i < limit; i += 1) {
      const char = rest[i];
      if (char === "<") inTag = true;
      else if (char === ">") inTag = false;
      else if (!inTag && /\s/.test(char)) cut = i;
    }
    // No safe break in range (one enormous unbroken word): keep it whole and
    // let the page fit it rather than dropping characters.
    if (cut <= 0) break;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut + 1);
  }
  if (rest.trim()) pieces.push(rest);
  return pieces;
}

/**
 * Split an entry's HTML into printable page chunks.
 *
 * Short entries stay on one page. Long entries flow across pages the way a
 * printed book does: paragraphs fill a page completely, and when a paragraph
 * does not fit in the space that is left it continues mid-paragraph on the
 * next page. The earlier all-or-nothing rule (a paragraph moved wholesale to
 * the next page) stranded up to 40% of every sheet as blank space, which both
 * looked unfinished and manufactured extra pages per entry.
 *
 * Every cut lands on whitespace OUTSIDE any tag, so markup is never sliced
 * in half. `charsPerPage` comes from `entryPageCapacity` for the current
 * viewport, so the split matches the sheet the reader actually draws.
 */
export function splitEntryPages(
  entry: DiaryEntry,
  charsPerPage: number = CHARS_PER_PAGE,
  continuationChars: number = charsPerPage,
): string[] {
  const html = entry.contentHtml || "";
  if (!html) return [""];
  if (entry.plainText.length <= charsPerPage) return [html];

  const blocks = html
    .split(/(?=<p[\s>])|(?<=<\/p>)|(?<=<br\s*\/?>)/i)
    .filter((b) => b.trim().length > 0);

  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) chunks.push(current);
    current = "";
  };
  /** The first page carries the entry header; the rest do not. */
  const limitNow = () => (chunks.length === 0 ? charsPerPage : continuationChars);
  /** Never top a page up with fewer characters than this — it would read as
   *  a one-word orphan line rather than a filled page. */
  const minSlice = Math.max(60, Math.floor(continuationChars * 0.15));

  for (const block of blocks) {
    let rest = block.trim();
    while (rest) {
      const limit = limitNow();
      if (!current) {
        if (rest.length > limit) {
          const pieces = splitBlockHtml(rest, limit);
          chunks.push(pieces[0]);
          rest = pieces.slice(1).join(" ");
          continue;
        }
        current = rest;
        rest = "";
        continue;
      }
      if (current.length + rest.length <= limit) {
        current += rest;
        rest = "";
        continue;
      }
      // The block overflows the page. Fill what is left from its top —
      // unless the remainder is too small to be worth a slice.
      const space = limit - current.length;
      if (space >= minSlice) {
        const pieces = splitBlockHtml(rest, space);
        if (pieces[0] && current.length + pieces[0].length <= limit) {
          current += pieces[0];
          rest = pieces.slice(1).join(" ");
        }
      }
      flush();
    }
  }
  flush();
  return chunks.length ? chunks : [html];
}

/**
 * Compute the full page layout of a book.
 *
 * Physical order: cover (position 1) → contents pages → entry pages →
 * back cover. Printed numbers run only across the entry section, starting
 * at 1. When entries grow past one contents page, the contents section
 * grows page-by-page and every row's printed number stays correct because
 * the layout is recomputed from the real structure.
 */
export function computeLayout(
  entries: DiaryEntry[],
  charsPerPage: number = CHARS_PER_PAGE,
  continuationChars: number = charsPerPage,
): BookLayout {
  const active = entries.filter((e) => !e.deletedAt);
  const contentsPageCount = Math.max(
    1,
    Math.ceil(active.length / CONTENTS_ROWS_PER_PAGE),
  );

  const pages: DiaryPage[] = [{ index: 1, kind: "cover" }];

  for (let i = 0; i < contentsPageCount; i++) {
    pages.push({
      index: pages.length + 1,
      kind: "contents",
      contentsIndex: i,
      totalParts: contentsPageCount,
    });
  }

  const contentsRows: ContentsRow[] = [];
  // Printed numbering starts with the first entry page, skipping the
  // cover and contents sections entirely.
  let printed = 0;
  for (const entry of active) {
    const parts = splitEntryPages(entry, charsPerPage, continuationChars).length;
    const startPage = printed + 1;
    for (let p = 0; p < parts; p++) {
      printed += 1;
      pages.push({
        index: pages.length + 1,
        number: printed,
        kind: "entry",
        entryId: entry.id,
        partIndex: p,
        totalParts: parts,
      });
    }
    contentsRows.push({
      entryId: entry.id,
      title: entry.title || "Untitled",
      date: entry.date,
      page: startPage,
    });
  }

  pages.push({ index: pages.length + 1, kind: "back-cover" });

  return { pages, contentsRows, contentsPageCount };
}

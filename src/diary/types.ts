/**
 * Local Diary Core — domain model.
 *
 * The diary is LOCAL-FIRST: every record lives in the user's local database
 * (IndexedDB via Dexie) and is portable via JSON backup/import.
 * Records carry sync-ready metadata (version, updatedAt, deletedAt) so a
 * future cloud sync layer can attach without changing this model.
 */

export const SCHEMA_VERSION = 1;

export const COVER_STYLES = [
  "ink",
  "forest",
  "ocean",
  "wine",
  "sand",
  "midnight",
] as const;

export type CoverStyle = (typeof COVER_STYLES)[number];

export function isCoverStyle(value: unknown): value is CoverStyle {
  return (
    typeof value === "string" &&
    (COVER_STYLES as readonly string[]).includes(value)
  );
}

/**
 * Interior page styles a book can use (defined as CSS utilities in index.css).
 * `custom` means "the user's own page image" and always travels with
 * `DiaryBookMeta.pageImage`.
 */
export const PAGE_STYLES = [
  "lined",
  "dotted",
  "grid",
  "blank",
  "vintage",
  "custom",
] as const;

export type PageStyle = (typeof PAGE_STYLES)[number];

export function isPageStyle(value: unknown): value is PageStyle {
  return (
    typeof value === "string" &&
    (PAGE_STYLES as readonly string[]).includes(value)
  );
}

/** CSS utility class (index.css) for each page style. */
export const PAGE_STYLE_CLASS: Record<PageStyle, string> = {
  lined: "page-lined",
  dotted: "page-dotted",
  grid: "page-grid",
  blank: "page-blank",
  vintage: "page-vintage",
  custom: "page-custom",
};

/** Human labels for the page-style picker. */
export const PAGE_STYLE_LABELS: Record<PageStyle, string> = {
  lined: "Lined",
  dotted: "Dotted",
  grid: "Grid",
  blank: "Blank",
  vintage: "Vintage",
  custom: "Your image",
};

/**
 * The style a book actually renders with: a `custom` style without an image
 * falls back to classic ruled paper.
 */
export function effectivePageStyle(book: {
  pageStyle: PageStyle;
  pageImage?: string | null;
}): PageStyle {
  if (book.pageStyle === "custom" && !book.pageImage) return "lined";
  return book.pageStyle;
}

/** A diary book. Owned by exactly one local user (ownerId). */
export interface DiaryBookMeta {
  id: string;
  ownerId: string;
  title: string;
  subtitle: string;
  author: string;
  coverStyle: CoverStyle;
  /**
   * Optional custom cover image (compact JPEG data URL). When set, the cover
   * renders ONLY the image — title/subtitle/author are not overlaid.
   */
  coverImage: string | null;
  /** Interior page style (lined, dotted, grid, blank, vintage, custom). */
  pageStyle: PageStyle;
  /**
   * Optional custom page image (compact JPEG data URL), used when
   * `pageStyle` is `custom`. Rendered full-bleed behind the writing.
   */
  pageImage: string | null;
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
}

/** A single diary entry. Content is stored as sanitized rich-text HTML. */
export interface DiaryEntry {
  id: string;
  bookId: string;
  ownerId: string;
  title: string;
  /** ISO date, yyyy-mm-dd — the day the memory happened. */
  date: string;
  /** Sanitized HTML (whitelisted formatting tags only). */
  contentHtml: string;
  /** Plain-text projection kept in sync for search + pagination. */
  plainText: string;
  tags: string[];
  mood: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  deletedAt: number | null;
}

/** Shape used by the backup/export format. */
export interface DiaryBackup {
  app: "local-diary-core";
  schemaVersion: number;
  exportedAt: number;
  ownerToken?: string;
  books: DiaryBookMeta[];
  entries: DiaryEntry[];
}

export type SaveState = "idle" | "typing" | "saving" | "saved" | "error";

/** Lightweight local preferences (localStorage, never diary content). */
export interface DiaryPrefs {
  appLockEnabled: boolean;
  /** Hash of the app-lock PIN — never the PIN itself. */
  appLockHash: string | null;
  appLockSalt: string | null;
  autoLockMinutes: number;
  geminiApiKey: string;
  lastBookId: string | null;
  /**
   * Enter full screen automatically once the user is signed in. Only applies
   * when the app runs in a browser tab — an installed (standalone) app already
   * opens without any browser chrome.
   */
  openInFullScreen: boolean;
  /** Cached ownerId of the most recent authenticated session for seamless offline diary access. */
  lastOwnerId: string | null;
}

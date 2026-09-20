/**
 * Book export — the two share/keep outputs available while reading.
 *
 *   1. printCurrentPage() — opens the browser print dialog with the book's
 *      cover sheet followed by every page the reader currently has on
 *      screen (both halves of an open spread).
 *   2. downloadBookPdf()  — builds a real PDF of the whole diary (cover,
 *      contents, every entry with the book's paper style and the same
 *      entry-only page numbering the reader uses) and downloads it.
 *
 * jsPDF is imported lazily inside downloadBookPdf so it never lands in the
 * main bundle; until the user asks for a PDF, nothing extra is loaded.
 */
import {
  CONTENTS_ROWS_PER_PAGE,
  splitEntryPages,
  type BookLayout,
  type DiaryPage,
} from "./pagination";
import {
  PAGE_STYLE_CLASS,
  effectivePageStyle,
  type CoverStyle,
  type DiaryBookMeta,
  type DiaryEntry,
} from "./types";

/* ------------------------------------------------------------------ print */

const COVER_GRADIENTS: Record<CoverStyle, string> = {
  ink: "linear-gradient(135deg,#2b2d42,#3d4266)",
  forest: "linear-gradient(135deg,#1b3a2f,#2d5a44)",
  ocean: "linear-gradient(135deg,#14324f,#2563eb)",
  wine: "linear-gradient(135deg,#4a1530,#7a2347)",
  sand: "linear-gradient(135deg,#b89b6e,#d9c9a3)",
  midnight: "linear-gradient(135deg,#0f172a,#312e81)",
};

const COVER_COLORS: Record<CoverStyle, string> = {
  ink: "#2b2d42",
  forest: "#1b3a2f",
  ocean: "#14324f",
  wine: "#4a1530",
  sand: "#b89b6e",
  midnight: "#0f172a",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const PRINT_CSS = `
  @page { margin: 0; size: A4 landscape; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #1a1a1a;
    font-family: Georgia, "Times New Roman", serif; }
  /* Deliberately no overflow:hidden here: a long entry prints in full, and
     clipping it to one sheet would silently drop the end of the writing.
     Anything past the sheet simply flows onto the next printed page. */
  .sheet { width: 100%; min-height: 100vh; padding: 14mm 18mm; position: relative;
    page-break-after: always; }
  .sheet:last-child { page-break-after: auto; }
  .cover { display: flex; flex-direction: column; justify-content: center;
    align-items: center; text-align: center; color: #fff; }
  .cover .kicker { font-size: 9pt; letter-spacing: .3em; text-transform: uppercase;
    opacity: .75; margin: 0; }
  .cover h1 { font-size: 30pt; margin: 10pt 0 0; line-height: 1.15; }
  .cover .sub { font-size: 12pt; opacity: .85; margin: 10pt 0 0; max-width: 74%; }
  .cover .by { font-size: 11pt; font-style: italic; opacity: .8; margin: 22pt 0 0; }
  .cover-img { padding: 0; }
  .cover-img img { width: 100%; height: 100vh; object-fit: cover; display: block; }
  .kicker { font-size: 8.5pt; letter-spacing: .22em; text-transform: uppercase;
    color: #8a8272; margin: 0; }
  .head { border-bottom: 1px solid #d8d2c6; padding-bottom: 8pt; margin-bottom: 14pt; }
  .entry h2, .toc h2 { font-size: 22pt; margin: 4pt 0 0; }
  .mood { font-size: 10pt; font-style: italic; color: #8a8272; margin: 4pt 0 0; }
  .body { font-size: 11.5pt; line-height: 1.8; color: #1a1a1a; }
  .body p { margin: 0 0 8pt; }
  .body h1 { font-size: 18pt; font-weight: 700; margin: 14pt 0 6pt; color: #111; }
  .body h2 { font-size: 15pt; font-weight: 700; margin: 12pt 0 5pt; color: #1a1a1a; }
  .body h3 { font-size: 13pt; font-weight: 600; margin: 10pt 0 4pt; color: #222; }
  .body h4 { font-size: 11.5pt; font-weight: 600; margin: 8pt 0 4pt; color: #2b2b2b; }
  .body h5 { font-size: 10pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin: 6pt 0 3pt; color: #333; }
  .body ul { list-style-type: disc; padding-left: 18pt; margin: 0 0 8pt; }
  .body ul[data-list-style="disc"] { list-style-type: disc; }
  .body ul[data-list-style="circle"] { list-style-type: circle; }
  .body ul[data-list-style="square"] { list-style-type: square; }
  .body ol { list-style-type: decimal; padding-left: 18pt; margin: 0 0 8pt; }
  .body ol[type="A"] { list-style-type: upper-alpha; }
  .body ol[type="a"] { list-style-type: lower-alpha; }
  .body ol[type="I"] { list-style-type: upper-roman; }
  .body ol[type="i"] { list-style-type: lower-roman; }
  .body ul.diary-checklist { list-style-type: none !important; padding-left: 2pt; margin: 0 0 8pt; }
  .body ul.diary-checklist li { display: flex; align-items: baseline; gap: 6pt; margin-bottom: 3pt; }
  .body ul.diary-checklist li[data-checked="true"] { text-decoration: line-through; opacity: 0.65; }
  .body ul.diary-checklist input[type="checkbox"] { margin-right: 4pt; vertical-align: middle; }
  .body blockquote { margin: 8pt 0; padding: 4pt 0 4pt 10pt; border-left: 3pt solid #b9b1a0;
    color: #444; font-style: italic; background: rgba(0,0,0,0.02); }
  .body strong, .body b { font-weight: 700; }
  .body em, .body i { font-style: italic; }
  .body u { text-decoration: underline; }
  .body s, .body del, .body strike { text-decoration: line-through; }
  .body a { color: #1a1a1a; text-decoration: underline; text-underline-offset: 2px; }
  .foot { position: absolute; left: 18mm; right: 18mm; bottom: 12mm; display: flex;
    justify-content: space-between; font-size: 9pt; color: #8a8272; }
  .toc-row { display: flex; align-items: baseline; gap: 6pt; font-size: 11.5pt;
    margin-bottom: 9pt; }
  .toc-row .t { font-weight: 600; }
  .toc-row .dots { flex: 1; border-bottom: 1px dotted #b9b1a0; }
  /* These must match PAGE_STYLE_CLASS (page-lined, page-grid, ...) — the
     sheets carry those class names, so the old .paper-* rules never applied
     and printed pages lost their paper entirely. */
  .page-lined { background-image: repeating-linear-gradient(to bottom,
    transparent 0 21pt, #e8e4da 21pt 21.5pt); }
  .page-grid { background-image: repeating-linear-gradient(to bottom,
    transparent 0 21pt, #e8e4da 21pt 21.5pt), repeating-linear-gradient(to right,
    transparent 0 21pt, #e8e4da 21pt 21.5pt); }
  .page-dotted { background-image: radial-gradient(#d7d1c4 0.6pt, transparent 0.7pt);
    background-size: 21pt 21pt; }
  .page-vintage { background-color: #faf3e2; }
  /* .page-custom paints the user's image through the inline background-image
     the sheet carries (see entrySheet), under the veil below. */
  /* A custom page image prints with the same paper veil the reader shows, so
     the writing stays readable on top of the picture. */
  .sheet.has-image { background-size: cover; background-position: center;
    background-repeat: no-repeat; }
  .sheet.has-image > .veil { position: absolute; inset: 0;
    background: rgba(252, 250, 244, .55); }
  .sheet.has-image > .head, .sheet.has-image > .body, .sheet.has-image > .foot {
    position: relative; z-index: 1; }
`;

function coverSheet(book: DiaryBookMeta, entryCount: number): string {
  if (book.coverImage) {
    return `<section class="sheet cover-img"><img src="${book.coverImage}" alt="${escapeHtml(
      book.title,
    )}" /></section>`;
  }
  return `<section class="sheet cover" style="background:${
    COVER_GRADIENTS[book.coverStyle]
  }">
    <p class="kicker">${entryCount} memories</p>
    <h1>${escapeHtml(book.title)}</h1>
    ${book.subtitle ? `<p class="sub">${escapeHtml(book.subtitle)}</p>` : ""}
    <p class="by">${book.author ? `by ${escapeHtml(book.author)}` : "a private diary"}</p>
  </section>`;
}

function entrySheet(
  entry: DiaryEntry,
  html: string,
  printedNumber: number,
  pageStyleClass: string,
  pageImage: string | null,
): string {
  return `<section class="sheet entry ${pageStyleClass}${
    pageImage ? " has-image" : ""
  }"${
    pageImage
      ? ` style="background-image:url(${pageImage})"`
      : ""
  }>
    ${pageImage ? `<div class="veil"></div>` : ""}
    <div class="head">
      <p class="kicker">${escapeHtml(entry.date)}</p>
      <h2>${escapeHtml(entry.title || "Untitled")}</h2>
      ${entry.mood ? `<p class="mood">${escapeHtml(entry.mood)}</p>` : ""}
    </div>
    <div class="body">${html || "<p><em>Empty entry</em></p>"}</div>
    <div class="foot"><span>${escapeHtml(
      entry.tags.length ? entry.tags.map((t) => `#${t}`).join("  ") : "",
    )}</span><span>${printedNumber || ""}</span></div>
  </section>`;
}

function backCoverSheet(book: DiaryBookMeta): string {
  return `<section class="sheet toc"><div class="head"><h2>${escapeHtml(
    book.title,
  )}</h2></div>
    <p class="body"><em>Every page you write keeps a memory alive.</em></p></section>`;
}

function contentsSheet(layout: BookLayout, contentsIndex: number): string {
  const start = contentsIndex * CONTENTS_ROWS_PER_PAGE;
  const rows = layout.contentsRows.slice(start, start + CONTENTS_ROWS_PER_PAGE);
  return `<section class="sheet toc">
    <div class="head"><p class="kicker">${escapeHtml("Local Diary Core")}</p><h2>Contents</h2></div>
    ${
      rows.length
        ? rows
            .map(
              (r) =>
                `<div class="toc-row"><span class="t">${escapeHtml(
                  r.title,
                )}</span><span class="dots"></span><span>${r.page}</span></div>`,
            )
            .join("")
        : `<p><em>No entries yet.</em></p>`
    }
  </section>`;
}

/**
 * Print the book's cover sheet followed by every page currently on screen.
 *
 * The reader shows a spread, so `pages` normally carries two entries (the
 * left and the right page) — printing only the first one silently dropped
 * the facing page. Long entries print in full, and an entry whose continuation
 * is the facing page still prints exactly once.
 */
export function printCurrentPage({
  book,
  entries,
  layout,
  pages,
}: {
  book: DiaryBookMeta;
  entries: DiaryEntry[];
  layout: BookLayout;
  pages: DiaryPage[];
}): void {
  const active = entries.filter((e) => !e.deletedAt);
  const style = effectivePageStyle(book);
  const pageStyleClass = PAGE_STYLE_CLASS[style] ?? "page-lined";
  const pageImage = style === "custom" ? book.pageImage : null;
  const sheets: string[] = [];
  const printedEntryIds = new Set<string>();

  // The cover always leads the printout. When the reader is looking at the
  // cover itself, that sheet is simply the page on screen.
  if (!pages.some((p) => p.kind === "cover"))
    sheets.push(coverSheet(book, active.length));

  for (const page of pages) {
    if (page.kind === "cover") {
      sheets.push(coverSheet(book, active.length));
    } else if (page.kind === "entry" && page.entryId) {
      // A spread can show an entry's first page and its continuation — the
      // entry prints once, in full, at its own page number.
      if (printedEntryIds.has(page.entryId)) continue;
      const entry = entries.find((e) => e.id === page.entryId);
      if (!entry) continue;
      printedEntryIds.add(page.entryId);
      const html = splitEntryPages(entry).join("");
      sheets.push(
        entrySheet(entry, html, page.number ?? 0, pageStyleClass, pageImage),
      );
    } else if (page.kind === "contents") {
      sheets.push(contentsSheet(layout, page.contentsIndex ?? 0));
    } else if (page.kind === "back-cover") {
      sheets.push(backCoverSheet(book));
    }
  }

  const doc = `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(
    book.title,
  )}</title><style>${PRINT_CSS}</style></head><body>${sheets.join("")}</body></html>`;
  printHtml(doc);
}

/** Print an arbitrary same-origin HTML document via a hidden iframe. */
function printHtml(html: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  // Off-screen but still laid out — a `visibility:hidden` iframe prints blank.
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(frame);
  const cleanup = () => window.setTimeout(() => frame.remove(), 1500);
  const win = frame.contentWindow;
  const doc = win?.document;
  if (!win || !doc) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const go = () => {
    try {
      win.focus();
      win.print();
    } catch {
      // ignore — some browsers block programmatic printing
    }
    cleanup();
  };
  // Give the iframe a beat to lay out (and for the cover image to decode).
  window.setTimeout(go, 250);
}

/* -------------------------------------------------------------------- pdf */

const MARGIN = 44;
const LINE_H = 17;
const HEADER_H = 84;
const CONTINUE_HEADER_H = 30;
const FOOTER_H = 26;
const FONT_SIZE = 11;
const TOC_ROW_H = 26;

interface PdfLine {
  text: string;
  style: "normal" | "bold" | "italic";
  size: number;
  indent: number;
}

interface TextPage {
  entry: DiaryEntry;
  lines: PdfLine[];
  partIndex: number;
  totalParts: number;
  number: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function imageFormat(src: string): string {
  if (src.startsWith("data:image/png")) return "PNG";
  if (src.startsWith("data:image/webp")) return "WEBP";
  return "JPEG";
}

function loadImageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = src;
  });
}

/**
 * Prepare the custom page image for the PDF: cropped to the page's own aspect
 * ratio, downscaled (a full-resolution photo on every page would balloon the
 * file) and pre-composited with the paper veil so text stays readable.
 * Returns null when the image cannot be decoded.
 */
function preparePageImage(src: string, W: number, H: number): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(null);
    img.onload = () => {
      const targetW = 1100;
      const targetH = Math.max(1, Math.round((targetW * H) / W));
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      // Cover-fit: fill the page without distorting the artwork.
      const scale = Math.max(
        targetW / img.naturalWidth,
        targetH / img.naturalHeight,
      );
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, (targetW - w) / 2, (targetH - h) / 2, w, h);
      // Same light veil the reader shows — heavy enough to keep the ink
      // readable, light enough that the chosen paper is still visible.
      ctx.fillStyle = "rgba(252, 250, 244, 0.55)";
      ctx.fillRect(0, 0, targetW, targetH);
      resolve(canvas.toDataURL("image/jpeg", 0.72));
    };
    img.src = src;
  });
}

/**
 * Build and download a PDF of the entire diary: cover, contents, then every
 * entry, paginated with the same entry-only page numbering the reader shows.
 */
export async function downloadBookPdf({
  book,
  entries,
  onProgress,
}: {
  book: DiaryBookMeta;
  entries: DiaryEntry[];
  onProgress?: (message: string) => void;
}): Promise<void> {
  onProgress?.("Preparing your PDF…");
  const { jsPDF } = await import("jspdf");

  // Landscape pages — the same orientation as the printed sheets.
  const doc = new jsPDF({ unit: "pt", format: "a5", orientation: "landscape" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  /** Body column kept narrow and centred so lines stay readable in landscape. */
  const contentW = Math.min(W - MARGIN * 2, 430);
  const LEFT = (W - contentW) / 2;
  const bodyBottom = H - MARGIN - FOOTER_H;

  const active = entries.filter((e) => !e.deletedAt);

  // ---------------------------------------------------------- pagination
  const measure = (
    text: string,
    style: "normal" | "bold" | "italic",
    size: number,
  ): string[] => {
    doc.setFont("times", style);
    doc.setFontSize(size);
    return doc.splitTextToSize(text, contentW) as string[];
  };

  /** Where the entry body starts on its first page (header size varies). */
  const firstBodyTop = (entry: DiaryEntry): number => {
    const titleLines = measure(entry.title || "Untitled", "bold", 20).length;
    let ty = MARGIN + 32 + (titleLines - 1) * 24;
    if (entry.mood) ty += 18;
    return Math.max(ty + 24, MARGIN + HEADER_H);
  };

  const firstCapacityFor = (entry: DiaryEntry): number =>
    Math.max(1, Math.floor((bodyBottom - firstBodyTop(entry)) / LINE_H));

  const otherCapacity = Math.max(
    1,
    Math.floor((bodyBottom - MARGIN - CONTINUE_HEADER_H) / LINE_H),
  );

  /** Contents pages in the PDF fit however many rows the page can hold —
   *  it is a different (landscape) sheet size than the on-screen reader. */
  const tocStart = MARGIN + 78;
  const tocRows = Math.max(
    1,
    Math.floor((H - MARGIN - tocStart) / TOC_ROW_H),
  );

  function parseHtmlToPdfLines(entry: DiaryEntry): PdfLine[] {
    const html = entry.contentHtml || "";
    const plain = (entry.plainText || "").trim();
    if (!html || typeof DOMParser === "undefined") {
      if (!plain) return [];
      doc.setFont("times", "normal");
      doc.setFontSize(FONT_SIZE);
      const lines = doc.splitTextToSize(plain, contentW) as string[];
      return lines.map((l) => ({ text: l, style: "normal", size: FONT_SIZE, indent: 0 }));
    }

    try {
      const parser = new DOMParser();
      const parsed = parser.parseFromString(`<body>${html}</body>`, "text/html");
      const body = parsed.body;
      const result: PdfLine[] = [];

      const processBlock = (node: Element) => {
        const tag = node.tagName.toLowerCase();
        let style: "normal" | "bold" | "italic" = "normal";
        let size = FONT_SIZE;
        let indent = 0;

        if (tag === "h1") {
          style = "bold";
          size = 15;
        } else if (tag === "h2") {
          style = "bold";
          size = 13.5;
        } else if (tag === "h3") {
          style = "bold";
          size = 12;
        } else if (tag === "h4" || tag === "h5") {
          style = "bold";
          size = 11;
        } else if (tag === "blockquote") {
          style = "italic";
          size = 10.5;
          indent = 14;
        } else if (tag === "ul" || tag === "ol") {
          const isChecklist = node.classList.contains("diary-checklist");
          const listStyle = node.getAttribute("data-list-style") || "";
          const olType = node.getAttribute("type") || "1";
          const items = Array.from(node.querySelectorAll(":scope > li"));
          items.forEach((li, idx) => {
            let itemPrefix = "• ";
            if (isChecklist) {
              const isChecked =
                li.getAttribute("data-checked") === "true" ||
                !!li.querySelector('input[type="checkbox"]:checked');
              itemPrefix = isChecked ? "[✓] " : "[ ] ";
            } else if (tag === "ol") {
              if (olType === "A") itemPrefix = `${String.fromCharCode(65 + (idx % 26))}. `;
              else if (olType === "a") itemPrefix = `${String.fromCharCode(97 + (idx % 26))}. `;
              else itemPrefix = `${idx + 1}. `;
            } else {
              if (listStyle === "circle") itemPrefix = "○ ";
              else if (listStyle === "square") itemPrefix = "▪ ";
              else itemPrefix = "• ";
            }
            const text = (li.textContent || "").trim();
            if (!text) return;
            doc.setFont("times", "normal");
            doc.setFontSize(FONT_SIZE);
            const lines = doc.splitTextToSize(`${itemPrefix}${text}`, contentW - 14) as string[];
            lines.forEach((l) => {
              result.push({ text: l, style: "normal", size: FONT_SIZE, indent: 14 });
            });
          });
          return;
        }

        const rawText = (node.textContent || "").trim();
        if (!rawText) return;
        doc.setFont("times", style);
        doc.setFontSize(size);
        const lines = doc.splitTextToSize(rawText, contentW - indent) as string[];
        lines.forEach((l) => {
          result.push({ text: l, style, size, indent });
        });
      };

      const childBlocks = Array.from(body.children);
      if (childBlocks.length > 0) {
        for (const child of childBlocks) {
          processBlock(child);
        }
      } else {
        const raw = (body.textContent || plain).trim();
        if (raw) {
          doc.setFont("times", "normal");
          doc.setFontSize(FONT_SIZE);
          const lines = doc.splitTextToSize(raw, contentW) as string[];
          lines.forEach((l) => result.push({ text: l, style: "normal", size: FONT_SIZE, indent: 0 }));
        }
      }

      return result.length > 0 ? result : [];
    } catch {
      if (!plain) return [];
      doc.setFont("times", "normal");
      doc.setFontSize(FONT_SIZE);
      const lines = doc.splitTextToSize(plain, contentW) as string[];
      return lines.map((l) => ({ text: l, style: "normal", size: FONT_SIZE, indent: 0 }));
    }
  }

  const textPages: TextPage[] = [];
  let printed = 0;
  for (const entry of active) {
    const lines = parseHtmlToPdfLines(entry);
    const capacities = firstCapacityFor(entry);
    const parts: PdfLine[][] = [];
    let rest = lines;
    let first = true;
    if (!rest.length) parts.push([]);
    while (rest.length) {
      const capacity = first ? capacities : otherCapacity;
      parts.push(rest.slice(0, capacity));
      rest = rest.slice(capacity);
      first = false;
    }
    parts.forEach((part, i) => {
      printed += 1;
      textPages.push({
        entry,
        lines: part,
        partIndex: i,
        totalParts: parts.length,
        number: printed,
      });
    });
  }

  const startPageOf = new Map<string, number>();
  for (const p of textPages) {
    if (!startPageOf.has(p.entry.id)) startPageOf.set(p.entry.id, p.number);
  }
  const contentsPages = Math.max(1, Math.ceil(active.length / tocRows));

  // ------------------------------------------------------------ rendering
  let firstPage = true;
  const newPage = () => {
    if (firstPage) firstPage = false;
    else doc.addPage();
  };

  // Cover — the uploaded artwork when present, otherwise the styled cover.
  newPage();
  const [cr, cg, cb] = hexToRgb(COVER_COLORS[book.coverStyle] ?? "#2b2d42");
  doc.setFillColor(cr, cg, cb);
  doc.rect(0, 0, W, H, "F");
  if (book.coverImage) {
    const size = await loadImageSize(book.coverImage);
    if (size.w > 0 && size.h > 0) {
      const scale = Math.min(W / size.w, H / size.h);
      const w = size.w * scale;
      const h = size.h * scale;
      try {
        doc.addImage(
          book.coverImage,
          imageFormat(book.coverImage),
          (W - w) / 2,
          (H - h) / 2,
          w,
          h,
        );
      } catch {
        // unsupported image data — keep the plain coloured cover
      }
    }
  } else {
    doc.setTextColor(255, 255, 255);
    doc.setFont("times", "normal");
    doc.setFontSize(9);
    doc.text(`${active.length} MEMORIES`.toUpperCase(), W / 2, H / 2 - 90, {
      align: "center",
    });
    doc.setFont("times", "bold");
    doc.setFontSize(28);
    const titleLines = measure(book.title, "bold", 28);
    let cy = H / 2 - 50;
    for (const line of titleLines) {
      doc.text(line, W / 2, cy, { align: "center" });
      cy += 34;
    }
    if (book.subtitle) {
      doc.setFont("times", "normal");
      doc.setFontSize(12);
      for (const line of doc.splitTextToSize(book.subtitle, contentW) as string[]) {
        doc.text(line, W / 2, cy, { align: "center" });
        cy += 18;
      }
    }
    doc.setFont("times", "italic");
    doc.setFontSize(11);
    doc.text(book.author ? `by ${book.author}` : "a private diary", W / 2, cy + 26, {
      align: "center",
    });
  }

  // Contents
  for (let i = 0; i < contentsPages; i++) {
    newPage();
    doc.setTextColor(120, 114, 100);
    doc.setFont("times", "normal");
    doc.setFontSize(9);
    doc.text("LOCAL DIARY CORE", LEFT, MARGIN + 8);
    doc.setTextColor(26, 26, 26);
    doc.setFont("times", "bold");
    doc.setFontSize(22);
    doc.text("Contents", LEFT, MARGIN + 38);
    doc.setDrawColor(216, 210, 198);
    doc.line(LEFT, MARGIN + 50, LEFT + contentW, MARGIN + 50);

    const rows = active.slice(i * tocRows, i * tocRows + tocRows);
    let y = tocStart;
    doc.setFont("times", "normal");
    doc.setFontSize(11);
    for (const entry of rows) {
      const title = entry.title || "Untitled";
      doc.setTextColor(26, 26, 26);
      doc.text(title, LEFT, y);
      const titleWidth = doc.getTextWidth(title);
      const number = String(startPageOf.get(entry.id) ?? 1);
      const numberWidth = doc.getTextWidth(number);
      doc.setTextColor(140, 133, 118);
      doc.setFillColor(185, 177, 160);
      const dotsEnd = LEFT + contentW - numberWidth - 8;
      for (let x = LEFT + titleWidth + 6; x < dotsEnd; x += 5) {
        doc.circle(x, y - 2, 0.5, "F");
      }
      doc.text(number, LEFT + contentW, y, { align: "right" });
      y += TOC_ROW_H;
    }
  }

  // Entry pages — the book's own paper, rendered in the PDF.
  const style = effectivePageStyle(book);
  const lined = style === "lined";
  const grid = style === "grid";
  const dotted = style === "dotted";
  const pageBackdrop =
    style === "custom" && book.pageImage
      ? await preparePageImage(book.pageImage, W, H)
      : null;

  for (const p of textPages) {
    newPage();

    if (pageBackdrop) {
      try {
        doc.addImage(pageBackdrop, "JPEG", 0, 0, W, H);
      } catch {
        // unsupported image data — the page keeps the plain paper look
      }
    }
    if (style === "vintage") {
      doc.setFillColor(250, 243, 226);
      doc.rect(0, 0, W, H, "F");
    }
    if (lined) {
      doc.setDrawColor(232, 228, 218);
      doc.setLineWidth(0.5);
      for (let y = MARGIN; y < bodyBottom; y += 24) {
        doc.line(LEFT, y, LEFT + contentW, y);
      }
    } else if (grid) {
      doc.setDrawColor(232, 228, 218);
      doc.setLineWidth(0.5);
      for (let y = MARGIN; y < bodyBottom; y += 24) {
        doc.line(LEFT, y, LEFT + contentW, y);
      }
      for (let x = LEFT; x < LEFT + contentW; x += 24) {
        doc.line(x, MARGIN, x, bodyBottom);
      }
    } else if (dotted) {
      doc.setFillColor(215, 209, 196);
      for (let y = MARGIN; y < bodyBottom; y += 24) {
        for (let x = LEFT; x < LEFT + contentW; x += 24) {
          doc.circle(x, y, 0.6, "F");
        }
      }
    }

    let y = MARGIN;
    if (p.partIndex === 0) {
      doc.setTextColor(140, 133, 118);
      doc.setFont("times", "normal");
      doc.setFontSize(8.5);
      doc.text(p.entry.date.toUpperCase(), LEFT, y + 8);
      doc.setTextColor(26, 26, 26);
      doc.setFont("times", "bold");
      doc.setFontSize(20);
      const titleLines = doc.splitTextToSize(
        p.entry.title || "Untitled",
        contentW,
      ) as string[];
      let ty = y + 32;
      for (const line of titleLines) {
        doc.text(line, LEFT, ty);
        ty += 24;
      }
      if (p.entry.mood) {
        doc.setFont("times", "italic");
        doc.setFontSize(10);
        doc.setTextColor(140, 133, 118);
        doc.text(p.entry.mood, LEFT, ty + 2);
        ty += 18;
      }
      doc.setDrawColor(216, 210, 198);
      doc.line(LEFT, ty + 8, LEFT + 60, ty + 8);
      y = Math.max(ty + 24, MARGIN + HEADER_H);
    } else {
      doc.setFont("times", "italic");
      doc.setFontSize(9);
      doc.setTextColor(140, 133, 118);
      doc.text(`${p.entry.title || "Untitled"} (continued)`, LEFT, y + 12);
      y = MARGIN + CONTINUE_HEADER_H;
    }

    doc.setTextColor(26, 26, 26);
    for (const line of p.lines) {
      doc.setFont("times", line.style);
      doc.setFontSize(line.size);
      doc.text(line.text, LEFT + line.indent, y + line.size);
      y += LINE_H;
    }

    doc.setFont("times", "normal");
    doc.setFontSize(9);
    doc.setTextColor(140, 133, 118);
    // Only the printed page number — no "1 / 1" part counter.
    doc.text(String(p.number), W - MARGIN, H - MARGIN + 4, { align: "right" });
    onProgress?.(`Rendering pages… ${p.number} / ${printed}`);
  }

  doc.setProperties({
    title: book.title,
    subject: book.subtitle || "Local Diary Core",
    author: book.author || "Local Diary Core",
    creator: "Local Diary Core",
  });

  const safeName =
    book.title
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase() || "diary";
  doc.save(`${safeName}.pdf`);
}

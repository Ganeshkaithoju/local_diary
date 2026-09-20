/**
 * Backup / export / import — portable JSON format.
 *
 * The diary is user-owned: a backup is a plain JSON file the user downloads
 * and can re-import on any device. Import is validated and never silently
 * overwrites existing books unless the user explicitly confirms.
 */
import type { DiaryBackup } from "./types";
import type { StorageProvider } from "@/storage";
import { htmlToPlainText } from "./storage";
export function downloadBackup(backup: DiaryBackup): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const d = new Date(backup.exportedAt);
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  a.href = url;
  a.download = `LocalDiaryCore-Backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function makeBackup(storage: StorageProvider): Promise<DiaryBackup> {
  return storage.exportAll();
}

export async function readBackupFile(file: File): Promise<DiaryBackup> {
  const text = await file.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file could not be read as JSON.");
  }
  if (
    typeof data !== "object" ||
    data === null ||
    ((data as { app?: unknown }).app !== "local-diary-core" &&
      (data as { app?: unknown }).app !== "my-diary")
  ) {
    throw new Error("An imported diary file is invalid.");
  }
  const backup = data as DiaryBackup;
  if (!Array.isArray(backup.books) || !Array.isArray(backup.entries)) {
    throw new Error("An imported diary file is invalid.");
  }
  return backup;
}

/** Export a single book as a Markdown file (human-readable portability). */
export function downloadMarkdown(
  book: DiaryBookMetaLike,
  entries: DiaryEntryLike[],
): void {
  const lines: string[] = [];
  lines.push(`# ${book.title}`);
  if (book.subtitle) lines.push(`*${book.subtitle}*`);
  if (book.author) lines.push(`by ${book.author}`);
  lines.push("");
  for (const e of entries) {
    lines.push(`## ${e.title} — ${e.date}`);
    lines.push("");
    lines.push(e.plainText);
    lines.push("");
  }
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sanitizeFilename(book.title)}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface DiaryBookMetaLike {
  title: string;
  subtitle: string;
  author?: string;
}

export interface DiaryEntryLike {
  title: string;
  date: string;
  plainText: string;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "diary";
}

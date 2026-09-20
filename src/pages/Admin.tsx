/**
 * Admin — workspace operations area for Local Diary Core.
 *
 * Business-facing view of the local workspace: aggregate stats, a management
 * table of all books, and data tools (backup download, markdown export).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import {
  ArrowLeft,
  BookOpen,
  Database,
  Download,
  FileDown,
  FileText,
  Search,
  Shield,
  Trash2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LogoDropdown } from "@/components/LogoDropdown";
import { useDiaryStorage } from "@/hooks/use-diary-storage";
import type { DiaryBookMeta, DiaryEntry } from "@/diary/types";
import { downloadMarkdown } from "@/diary/backup";
import { htmlToPlainText } from "@/diary/storage";

export default function AdminPage() {
  const navigate = useNavigate();
  const storage = useDiaryStorage();
  const user = useQuery(api.users.currentUser);

  const [books, setBooks] = useState<DiaryBookMeta[] | null>(null);
  const [entries, setEntries] = useState<DiaryEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DiaryBookMeta | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [b, e] = await Promise.all([
        storage.listBooks(),
        storage.listAllEntries(),
      ]);
      if (!cancelled) {
        setBooks(b);
        setEntries(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storage]);

  const reload = async () => {
    const [b, e] = await Promise.all([
      storage.listBooks(),
      storage.listAllEntries(),
    ]);
    setBooks(b);
    setEntries(e);
  };

  const bookById = useMemo(() => {
    const map = new Map<string, DiaryBookMeta>();
    for (const b of books ?? []) map.set(b.id, b);
    return map;
  }, [books]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = books ?? [];
    if (q) {
      list = list.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.author.toLowerCase().includes(q) ||
          b.subtitle.toLowerCase().includes(q),
      );
    }
    return list.map((b) => {
      const bookEntries = (entries ?? []).filter((e) => e.bookId === b.id);
      return {
        book: b,
        entries: bookEntries.length,
        words: bookEntries.reduce(
          (sum, e) =>
            sum +
            e.plainText.trim().split(/\s+/).filter(Boolean).length,
          0,
        ),
        lastActivity: bookEntries.reduce(
          (max, e) => Math.max(max, e.updatedAt),
          b.updatedAt,
        ),
      };
    });
  }, [books, entries, query]);

  const totalEntries = entries?.length ?? 0;
  const totalWords = (entries ?? []).reduce(
    (sum, e) => sum + e.plainText.trim().split(/\s+/).filter(Boolean).length,
    0,
  );
  const activeDays = useMemo(() => {
    const days = new Set((entries ?? []).map((e) => e.date));
    return days.size;
  }, [entries]);

  const handleExportBook = (book: DiaryBookMeta) => {
    const bookEntries = (entries ?? [])
      .filter((e) => e.bookId === book.id)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((e) => ({
        title: e.title || "Untitled",
        date: e.date,
        plainText: e.plainText || htmlToPlainText(e.contentHtml),
      }));
    downloadMarkdown(book, bookEntries);
    toast.success(`Exported "${book.title}" as Markdown.`);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await storage.deleteBook(deleteTarget.id);
    toast.success("Book deleted.");
    setDeleteTarget(null);
    await reload();
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <LogoDropdown />
            <span className="meta-label">admin area</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {user?.email ?? "local workspace"}
            </span>
            <Button variant="outline" size="sm" onClick={() => navigate("/dashboard")}>
              Back to workspace
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        {/* Heading */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex size-10 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                <Shield className="size-5" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Admin area
              </h1>
            </div>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Operations view of this workspace — usage stats, book management,
              and local data tools. All data lives on this device.
            </p>
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter books…"
              className="pl-9"
            />
          </div>
        </div>

        {/* Stats */}
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="surface p-4">
            <p className="meta-label">books</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {books === null ? "—" : books.length}
            </p>
          </div>
          <div className="surface p-4">
            <p className="meta-label">entries</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {entries === null ? "—" : totalEntries}
            </p>
          </div>
          <div className="surface p-4">
            <p className="meta-label">words written</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {entries === null ? "—" : totalWords.toLocaleString()}
            </p>
          </div>
          <div className="surface p-4">
            <p className="meta-label">active days</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {entries === null ? "—" : activeDays}
            </p>
          </div>
        </div>

        {/* Book management table */}
        <div className="surface mt-6 overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <h2 className="text-sm font-semibold">Book management</h2>
            <span className="text-xs text-muted-foreground">
              {rows.length} shown
            </span>
          </div>
          {books === null ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <BookOpen className="size-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                {query
                  ? "No books match the filter."
                  : "No books yet — create one in the workspace."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead className="hidden sm:table-cell">Author</TableHead>
                  <TableHead className="text-right">Entries</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">
                    Words
                  </TableHead>
                  <TableHead className="hidden text-right md:table-cell">
                    Last activity
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ book, entries: n, words, lastActivity }) => (
                  <TableRow key={book.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block size-3 shrink-0 rounded-sm border border-white/10"
                          style={{ background: swatch(book.coverStyle) }}
                        />
                        <span className="font-medium">{book.title}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {book.author || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{n}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {words.toLocaleString()}
                    </TableCell>
                    <TableCell className="hidden text-right text-muted-foreground md:table-cell">
                      {new Date(lastActivity).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`Export ${book.title} as Markdown`}
                          onClick={() => handleExportBook(book)}
                        >
                          <FileDown className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive"
                          aria-label={`Delete ${book.title}`}
                          onClick={() => setDeleteTarget(book)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Data tools */}
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="surface p-5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Database className="size-4" />
            </div>
            <h3 className="mt-3 text-sm font-semibold">Full JSON backup</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Download every book and entry as a single validated JSON file for
              safekeeping or migration.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 gap-1.5"
              onClick={async () => {
                const { makeBackup, downloadBackup } = await import(
                  "@/diary/backup"
                );
                downloadBackup(await makeBackup(storage));
                toast.success("Backup downloaded.");
              }}
            >
              <Download className="size-4" />
              Download backup
            </Button>
          </div>
          <div className="surface p-5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileText className="size-4" />
            </div>
            <h3 className="mt-3 text-sm font-semibold">Per-book export</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Export any book as a clean Markdown file from the table above —
              ideal for publishing pipelines or archives.
            </p>
          </div>
          <div className="surface p-5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileDown className="size-4" />
            </div>
            <h3 className="mt-3 text-sm font-semibold">Local-only storage</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Content never leaves this device. The admin area manages the local
              database directly — no server round-trips.
            </p>
          </div>
        </div>
      </main>

      {/* Delete confirmation */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this book?</DialogTitle>
            <DialogDescription>
              &quot;{deleteTarget?.title}&quot; and all of its entries will be
              permanently removed from this device. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()}>
              Delete book
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function swatch(style: string): string {
  const map: Record<string, string> = {
    ink: "linear-gradient(135deg, #2b2d42, #3d4266)",
    forest: "linear-gradient(135deg, #1b3a2f, #2d5a44)",
    ocean: "linear-gradient(135deg, #14324f, #2563eb)",
    wine: "linear-gradient(135deg, #4a1530, #7a2347)",
    sand: "linear-gradient(135deg, #b89b6e, #d9c9a3)",
    midnight: "linear-gradient(135deg, #0f172a, #312e81)",
  };
  return map[style] ?? map.ink;
}

/**
 * BookLibrary — the authenticated home of Local Diary Core.
 *
 * A searchable catalog of the user's diary books: live title/author/entry-text
 * search, entry/word counts, and per-book detail navigation. The book detail
 * view (Dashboard) handles opening the reader and editor.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  BookOpen,
  FileText,
  Library,
  LogOut,
  MoreVertical,
  Plus,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { BookCover, coverSwatch } from "./BookCover";
import { PageStylePicker } from "./PageStylePicker";
import { useDiaryStorage } from "@/hooks/use-diary-storage";
import {
  COVER_STYLES,
  type CoverStyle,
  type DiaryBookMeta,
  type PageStyle,
} from "@/diary/types";
import { cn } from "@/lib/utils";

interface BookLibraryProps {
  onOpenBook: (book: DiaryBookMeta) => void;
  onOpenSettings: () => void;
  /** Present on workspace pages; ends the session when clicked. */
  onSignOut?: () => void;
  /** Bump to re-run the catalog query after external changes (delete/rename). */
  refreshKey?: number;
  /** Fired right after a book is created (drives the cover-upload popup). */
  onBookCreated?: (book: DiaryBookMeta) => void;
}

interface CatalogRow {
  book: DiaryBookMeta;
  entries: number;
  words: number;
}

export function BookLibrary(
  { onOpenBook, onOpenSettings, onSignOut, refreshKey = 0, onBookCreated }: BookLibraryProps,
) {
  const storage = useDiaryStorage();
  const user = useQuery(api.users.currentUser);

  const [rows, setRows] = useState<CatalogRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSubtitle, setNewSubtitle] = useState("");
  const [newAuthor, setNewAuthor] = useState("");
  const [newCover, setNewCover] = useState<CoverStyle>("ink");
  const [newPageStyle, setNewPageStyle] = useState<PageStyle>("lined");
  const [newPageImage, setNewPageImage] = useState<string | null>(null);

  // Load books + per-book stats from the owner-scoped local database.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [bookList, stats] = await Promise.all([
        storage.listBooks(),
        storage.entryStats(),
      ]);
      if (!cancelled) {
        setRows(
          bookList.map((book) => ({
            book,
            entries: stats.get(book.id)?.entries ?? 0,
            words: stats.get(book.id)?.words ?? 0,
          })),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storage, refreshKey]);

  const refresh = async () => {
    const [bookList, stats] = await Promise.all([
      storage.listBooks(),
      storage.entryStats(),
    ]);
    setRows(
      bookList.map((book) => ({
        book,
        entries: stats.get(book.id)?.entries ?? 0,
        words: stats.get(book.id)?.words ?? 0,
      })),
    );
  };

  const handleCreate = async () => {
    const title = newTitle.trim();
    if (!title) {
      toast.error("Give the book a title first.");
      return;
    }
    try {
      const book = await storage.createBook({
        ownerId: storage.currentOwnerId,
        title,
        subtitle: newSubtitle.trim(),
        author: newAuthor.trim() || (user?.name ?? ""),
        coverStyle: newCover,
        coverImage: null,
        pageStyle: newPageStyle,
        pageImage: newPageImage,
      });
      setCreateOpen(false);
      setNewTitle("");
      setNewSubtitle("");
      setNewAuthor("");
      setNewPageStyle("lined");
      setNewPageImage(null);
      await refresh();
      // The cover popup comes first; the catalog stays underneath.
      onBookCreated?.(book);
    } catch {
      toast.error("Could not create the book. Please try again.");
    }
  };

  const handleDelete = async (book: DiaryBookMeta) => {
    if (
      !window.confirm(
        `Delete "${book.title}" and all of its entries? This cannot be undone.`,
      )
    ) {
      return;
    }
    await storage.deleteBook(book.id);
    toast.success("Book deleted.");
    await refresh();
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows ?? [];
    if (!q) return list;
    return list.filter(
      (row) =>
        row.book.title.toLowerCase().includes(q) ||
        row.book.subtitle.toLowerCase().includes(q) ||
        row.book.author.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const totalEntries = (rows ?? []).reduce((sum, r) => sum + r.entries, 0);
  const totalWords = (rows ?? []).reduce((sum, r) => sum + r.words, 0);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
            <Library className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Catalog</h1>
            <p className="text-sm text-muted-foreground">
              {rows === null
                ? "Loading your library…"
                : `${rows.length} ${rows.length === 1 ? "book" : "books"} · ${totalEntries} ${totalEntries === 1 ? "entry" : "entries"} · ${totalWords.toLocaleString()} words written`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onOpenSettings} className="gap-1.5">
            <Settings className="size-4" />
            Settings
          </Button>
          {onSignOut && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onSignOut}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <LogOut className="size-4" />
              Sign out
            </Button>
          )}
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Plus className="size-4" />
                New book
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Create a new book</DialogTitle>
                <DialogDescription>
                  Every book is its own volume — a diary, a novel, a story
                  collection, a project journal.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="book-title">Title</Label>
                  <Input
                    id="book-title"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="My Life"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="book-subtitle">Subtitle</Label>
                  <Input
                    id="book-subtitle"
                    value={newSubtitle}
                    onChange={(e) => setNewSubtitle(e.target.value)}
                    placeholder="pages from an ordinary life"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="book-author">Author</Label>
                  <Input
                    id="book-author"
                    value={newAuthor}
                    onChange={(e) => setNewAuthor(e.target.value)}
                    placeholder="Your name"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Cover</Label>
                  <div className="flex flex-wrap gap-2">
                    {COVER_STYLES.map((style) => (
                      <button
                        key={style}
                        type="button"
                        onClick={() => setNewCover(style)}
                        aria-label={`Cover style ${style}`}
                        className={cn(
                          "h-10 w-8 rounded-md border-2 transition-transform hover:scale-105",
                          newCover === style
                            ? "border-primary ring-2 ring-ring/40"
                            : "border-border",
                        )}
                        style={{ background: coverSwatch(style) }}
                      />
                    ))}
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Page style</Label>
                  <PageStylePicker
                    value={newPageStyle}
                    pageImage={newPageImage}
                    onChange={setNewPageStyle}
                    onPickImage={setNewPageImage}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreate}>Create book</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {/* Search */}
      <div className="relative mt-6 max-w-md">
        <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title, subtitle, or author…"
          className="pl-9"
        />
      </div>

      {/* Grid */}
      {rows === null ? (
        <div className="mt-10 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="surface aspect-[3/4] animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="surface mt-8 flex flex-col items-center gap-3 p-12 text-center">
          <BookOpen className="size-10 text-muted-foreground/50" />
          <p className="text-lg font-medium">
            {search ? "No books match your search." : "Your shelf is empty"}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {search
              ? "Try a different title or author."
              : "Create your first book and start writing today."}
          </p>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map(({ book, entries, words }) => (
            <motion.div
              key={book.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="surface surface-hover group relative overflow-hidden"
            >
              <button
                className="block w-full text-left"
                onClick={() => onOpenBook(book)}
                aria-label={`Open ${book.title}`}
              >
                <div className="aspect-[3/4]">
                  <BookCover
                    book={book}
                    className="h-full w-full rounded-b-none border-0 shadow-none"
                  />
                </div>
                <div className="border-t p-3">
                  <p className="truncate text-sm font-semibold">{book.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {book.subtitle || book.author || "Untitled volume"}
                  </p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <Badge variant="secondary" className="gap-1 text-[10px]">
                      <FileText className="size-3" />
                      {entries} {entries === 1 ? "entry" : "entries"}
                    </Badge>
                    {words > 0 && (
                      <Badge variant="outline" className="text-[10px]">
                        {words.toLocaleString()} words
                      </Badge>
                    )}
                  </div>
                </div>
                <span className="sr-only">
                  {words.toLocaleString()} words across {entries} entries
                </span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1.5 top-1.5 size-7 bg-card/80 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100"
                    aria-label={`${book.title} options`}
                  >
                    <MoreVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onOpenBook(book)}>
                    <BookOpen className="mr-2 size-4" /> Open
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => void handleDelete(book)}
                  >
                    <Trash2 className="mr-2 size-4" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

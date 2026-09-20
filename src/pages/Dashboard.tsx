/**
 * Dashboard — the authenticated Local Diary Core workspace.
 *
 * Flow: app-lock gate → library → book view (contents sidebar, AI panel) →
 * full-screen page-flip reader or entry editor.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  ArrowLeft,
  BookOpen,
  ImagePlus,
  LogOut,
  Pencil,
  PencilLine,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogoDropdown } from "@/components/LogoDropdown";
import { BookLibrary } from "@/features/library/BookLibrary";
import { BookCover } from "@/features/library/BookCover";
import { CoverUploadDialog } from "@/features/library/CoverUploadDialog";
import { PageFlipReader } from "@/features/reader/PageFlipReader";
import { EntryEditor } from "@/features/editor/EntryEditor";
import { AIPanel } from "@/features/ai/AIPanel";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { LockScreen } from "@/features/lock/LockScreen";
import { DiaryStorageProvider, useDiaryStorage } from "@/hooks/use-diary-storage";
import { useAuth } from "@/hooks/use-auth";
import { usePrefs } from "@/diary/prefs";
import {
  clearUniqueKeyPrompt,
  shouldPromptUniqueKey,
} from "@/convex/uniqueKeyRules";
import { KeyRound } from "lucide-react";
import { resizeImageToDataUrl } from "@/diary/coverImage";
import { coverSwatch } from "@/features/library/BookCover";
import type { DiaryBookMeta, DiaryEntry, PageStyle } from "@/diary/types";
import { PageStylePicker } from "@/features/library/PageStylePicker";
import { cn } from "@/lib/utils";

type View =
  | { name: "library" }
  | { name: "book"; book: DiaryBookMeta }
  | { name: "reader"; book: DiaryBookMeta }
  | { name: "editor"; book: DiaryBookMeta; entry: DiaryEntry | null }
  | { name: "settings" };

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { prefs } = usePrefs();
  const ownerId = user?._id ?? prefs.lastOwnerId ?? "local";

  /** Sign out of the workspace and return to the public landing page. */
  const handleSignOut = useCallback(async () => {
    try {
      await signOut();
    } finally {
      navigate("/");
    }
  }, [signOut, navigate]);

  return (
    <DiaryStorageProvider ownerId={ownerId}>
      <DashboardInner />
    </DiaryStorageProvider>
  );
}

/**
 * One-time post-sign-up card: "create your own unique key". The flag is set
 * by the Auth page after a successful sign-up; tapping the CTA goes to
 * Settings, where the key is created and checked for uniqueness.
 */
function UniqueKeyPrompt({ onGoToSettings }: { onGoToSettings: () => void }) {
  const [open, setOpen] = useState(shouldPromptUniqueKey());

  if (!open) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) clearUniqueKeyPrompt();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex size-10 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
            <KeyRound className="size-5" />
          </div>
          <DialogTitle className="mt-2">Create your own unique key</DialogTitle>
          <DialogDescription>
            A unique key is a 6-character handle — one capital, one lowercase
            and one number — that only you can claim. Use it to sign in next
            time instead of typing your email and password.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => {
              setOpen(false);
              clearUniqueKeyPrompt();
            }}
          >
            Maybe later
          </Button>
          <Button
            onClick={() => {
              setOpen(false);
              clearUniqueKeyPrompt();
              onGoToSettings();
            }}
            className="gap-1.5"
          >
            <KeyRound className="size-4" />
            Create my key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DashboardInner() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const storage = useDiaryStorage();
  const { prefs } = usePrefs();

  const [view, setView] = useState<View>({ name: "library" });
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  /** Book awaiting its optional custom cover right after creation. */
  const [coverBook, setCoverBook] = useState<DiaryBookMeta | null>(null);

  const book =
    view.name === "library" || view.name === "settings" ? null : view.book;
  const bookId = book?.id ?? null;

  // Load entries whenever the active book changes.
  useEffect(() => {
    if (!bookId) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const list = await storage.listEntries(bookId);
      if (!cancelled) setEntries(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, storage]);

  const refreshEntries = useCallback(async () => {
    if (!bookId) return;
    setEntries(await storage.listEntries(bookId));
  }, [bookId, storage]);

  /**
   * Persist a book-level change (page style / custom page artwork) and keep
   * every view showing that book in sync — reader and writer included.
   */
  const updateBookStyle = useCallback(
    async (
      target: DiaryBookMeta,
      patch: { pageStyle?: PageStyle; pageImage?: string | null },
    ) => {
      try {
        await storage.updateBook(target.id, patch);
      } catch {
        toast.error("Could not update the page style. Please try again.");
        return;
      }
      // Merge into whatever the view currently holds: choosing a custom
      // image emits two patches in a row (image, then style), and both must
      // land on the same book object.
      setView((v) => {
        if (v.name === "library" || v.name === "settings") return v;
        if (v.book.id !== target.id) return v;
        const updated: DiaryBookMeta = {
          ...v.book,
          ...patch,
          updatedAt: Date.now(),
        };
        if (v.name === "book") return { name: "book", book: updated };
        if (v.name === "reader") return { name: "reader", book: updated };
        return { name: "editor", book: updated, entry: v.entry };
      });
      setLibraryRefresh((n) => n + 1);
    },
    [storage],
  );

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  if (view.name === "settings") {
    return (
      <div className="min-h-screen bg-background">
        <SettingsPage onBack={() => setView({ name: "library" })} />
      </div>
    );
  }

  if (view.name === "reader") {
    return (
      <PageFlipReader
        book={view.book}
        entries={entries}
        onEditEntry={(entryId) => {
          const entry = entries.find((e) => e.id === entryId) ?? null;
          setView({ name: "editor", book: view.book, entry });
        }}
        onClose={() => setView({ name: "book", book: view.book })}
        onChangePageStyle={(patch) => void updateBookStyle(view.book, patch)}
      />
    );
  }

  if (view.name === "editor") {
    // The entry written just before this one — enables "start from the
    // previous entry" for daily journaling without re-styling each time.
    const previousEntry =
      view.entry === null
        ? [...entries].sort((a, b) =>
            a.date === b.date
              ? b.createdAt - a.createdAt
              : a.date < b.date
                ? 1
                : -1,
          )[0] ?? null
        : null;
    return (
      <div className="min-h-screen bg-background">
        <EntryEditor
          bookId={view.book.id}
          entry={view.entry}
          previousEntry={previousEntry}
          pageStyle={view.book.pageStyle}
          pageImage={view.book.pageImage}
          onPageStyleChange={(patch) => void updateBookStyle(view.book, patch)}
          onBack={() => {
            setView({ name: "book", book: view.book });
            void refreshEntries();
          }}
          onSaved={() => void refreshEntries()}
        />
      </div>
    );
  }

  if (view.name === "book") {
    return (
      <>
        <BookView
          book={view.book}
          entries={entries}
          onBack={() => setView({ name: "library" })}
          onRead={() => setView({ name: "reader", book: view.book })}
          onEdit={(entry) => setView({ name: "editor", book: view.book, entry })}
          onNewEntry={() => setView({ name: "editor", book: view.book, entry: null })}
          onRename={() => setRenameOpen(true)}
          onOpenSettings={() => setView({ name: "settings" })}
          onSignOut={() => void handleSignOut()}
          onDeleted={() => {
            setView({ name: "library" });
            setLibraryRefresh((n) => n + 1);
          }}
        />
        <RenameBookDialog
          book={view.book}
          open={renameOpen}
          onOpenChange={setRenameOpen}
          onRenamed={(updated) => {
            setView((v) =>
              v.name === "book" && v.book.id === updated.id
                ? { name: "book", book: updated }
                : v,
            );
            setLibraryRefresh((n) => n + 1);
          }}
        />
      </>
    );
  }

  return (
    <>
      <UniqueKeyPrompt onGoToSettings={() => setView({ name: "settings" })} />
      <BookLibrary
        onOpenBook={(book) => setView({ name: "book", book })}
        onOpenSettings={() => setView({ name: "settings" })}
        onSignOut={() => void handleSignOut()}
        refreshKey={libraryRefresh}
        onBookCreated={(book) => setCoverBook(book)}
      />
      {/* "Add your own cover page" — pops up right after book creation */}
      {coverBook && (
        <CoverUploadDialog
          book={coverBook}
          open={!!coverBook}
          onOpenChange={(open) => {
            if (!open) setCoverBook(null);
          }}
          onSaved={(updated) => {
            // Keep the cover fresh wherever the book is rendered.
            setCoverBook(null);
            setLibraryRefresh((n) => n + 1);
            setView((v) =>
              v.name === "book" && v.book.id === updated.id
                ? { name: "book", book: updated }
                : v,
            );
          }}
        />
      )}
    </>
  );
}

/** Edit a book's title/subtitle/author, custom cover image, and page style. */
function RenameBookDialog({
  book,
  open,
  onOpenChange,
  onRenamed,
}: {
  book: DiaryBookMeta;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRenamed: (updated: DiaryBookMeta) => void;
}) {
  const storage = useDiaryStorage();
  const [title, setTitle] = useState(book.title);
  const [subtitle, setSubtitle] = useState(book.subtitle);
  const [author, setAuthor] = useState(book.author);
  const [pageStyle, setPageStyle] = useState<PageStyle>(book.pageStyle);
  const [pageImage, setPageImage] = useState<string | null>(book.pageImage);
  /** undefined = unchanged, null = removed, string = new image data URL. */
  const [coverImage, setCoverImage] = useState<string | null | undefined>(
    undefined,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle(book.title);
      setSubtitle(book.subtitle);
      setAuthor(book.author);
      setPageStyle(book.pageStyle);
      setPageImage(book.pageImage);
      setCoverImage(undefined);
    }
  }, [open, book]);

  const displayedCover =
    coverImage === undefined ? book.coverImage : coverImage;

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const dataUrl = await resizeImageToDataUrl(file);
    if (!dataUrl) {
      toast.error(
        "That image could not be used. Try a JPG, PNG, or WebP under 12 MB.",
      );
      return;
    }
    setCoverImage(dataUrl);
  };

  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error("The book needs a title.");
      return;
    }
    const patch = {
      title: trimmed,
      subtitle: subtitle.trim(),
      author: author.trim(),
      pageStyle,
      pageImage,
      ...(coverImage !== undefined ? { coverImage } : {}),
    };
    await storage.updateBook(book.id, patch);
    toast.success("Book details updated.");
    onOpenChange(false);
    onRenamed({ ...book, ...patch, updatedAt: Date.now() });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit book details</DialogTitle>
          <DialogDescription>
            Update the title, subtitle, author, cover and the paper used for
            this book's pages.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          {/* Custom cover image */}
          <div className="grid gap-2">
            <Label>Cover image</Label>
            <div className="flex items-start gap-3">
              <div
                className="h-24 w-18 shrink-0 overflow-hidden rounded-md border bg-paper"
                style={
                  displayedCover
                    ? undefined
                    : { background: coverSwatch(book.coverStyle) }
                }
              >
                {displayedCover ? (
                  <img
                    src={displayedCover}
                    alt="Cover preview"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center p-1 text-center text-[9px] uppercase tracking-widest text-white/70">
                    {book.title || "cover"}
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    void handleFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImagePlus className="size-3.5" />
                    {displayedCover ? "Replace image" : "Upload image"}
                  </Button>
                  {displayedCover && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-destructive hover:text-destructive"
                      onClick={() => setCoverImage(null)}
                    >
                      <Trash2 className="size-3.5" />
                      Remove
                    </Button>
                  )}
                </div>
                <p className="text-xs leading-4 text-muted-foreground">
                  With a custom cover, the cover shows only your image — the
                  title, subtitle and author are hidden so nothing overlaps
                  it.
                </p>
              </div>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rename-title">Title</Label>
            <Input
              id="rename-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rename-subtitle">Subtitle</Label>
            <Input
              id="rename-subtitle"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rename-author">Author</Label>
            <Input
              id="rename-author"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </div>
          {/* Page style — changeable at any time, not only at creation. */}
          <div className="grid gap-2">
            <Label>Page style</Label>
            <PageStylePicker
              value={pageStyle}
              pageImage={pageImage}
              onChange={setPageStyle}
              onPickImage={setPageImage}
              compact
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()}>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Book view: cover sidebar + entry list + AI                          */
/* ------------------------------------------------------------------ */

function BookView({
  book,
  entries,
  onBack,
  onRead,
  onEdit,
  onNewEntry,
  onRename,
  onOpenSettings,
  onSignOut,
  onDeleted,
}: {
  book: DiaryBookMeta;
  entries: DiaryEntry[];
  onBack: () => void;
  onRead: () => void;
  onEdit: (entry: DiaryEntry) => void;
  onNewEntry: () => void;
  onRename: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
  onDeleted: () => void;
}) {
  const storage = useDiaryStorage();

  const handleDeleteBook = async () => {
    if (
      !window.confirm(
        `Delete "${book.title}" and all of its entries? This cannot be undone.`,
      )
    )
      return;
    await storage.deleteBook(book.id);
    toast.success("Book deleted.");
    onDeleted();
  };

  const handleDeleteEntry = async (entry: DiaryEntry) => {
    if (!window.confirm(`Delete "${entry.title || "Untitled"}"? You can't undo this.`)) return;
    await storage.softDeleteEntry(entry.id);
    toast.success("Entry deleted.");
    setEntriesLocal(await storage.listEntries(book.id));
  };

  const [entriesLocal, setEntriesLocal] = useState<DiaryEntry[]>(entries);
  useEffect(() => setEntriesLocal(entries), [entries]);

  /** Entry search — matches title, text, date, mood and tags. */
  const [query, setQuery] = useState("");

  const activeEntries = useMemo(
    () => entriesLocal.filter((e) => !e.deletedAt),
    [entriesLocal],
  );

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeEntries;
    return activeEntries.filter(
      (entry) =>
        entry.title.toLowerCase().includes(q) ||
        entry.plainText.toLowerCase().includes(q) ||
        entry.date.includes(q) ||
        entry.mood.toLowerCase().includes(q) ||
        entry.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [activeEntries, query]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
            <ArrowLeft className="size-4" />
            Catalog
          </Button>
          <span className="meta-label">book detail</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onSignOut}
            className="ml-auto gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>

      <div className="mt-4 grid gap-8 lg:grid-cols-[280px_1fr]">
        {/* Sidebar */}
        <aside className="space-y-5">
          <div className="surface overflow-hidden">
            <div className="aspect-[3/4]">
              <BookCover book={book} className="h-full w-full rounded-none border-0 shadow-none" />
            </div>
            <div className="space-y-3 p-4">
              <Button onClick={onRead} className="w-full gap-1.5">
                <BookOpen className="size-4" />
                Open &amp; read
              </Button>
              <Button onClick={onNewEntry} variant="outline" className="w-full gap-1.5">
                <Plus className="size-4" />
                New entry
              </Button>
              <div className="flex gap-2">
                <Button onClick={onRename} variant="ghost" size="sm" className="h-8 flex-1 gap-1.5 text-xs">
                  <PencilLine className="size-3.5" />
                  Rename
                </Button>
                <Button
                  onClick={() => void handleDeleteBook()}
                  variant="ghost"
                  size="sm"
                  className="h-8 flex-1 gap-1.5 text-xs text-destructive hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
              </div>
            </div>
          </div>

          <AIPanel
            entries={entriesLocal}
            bookTitle={book.title}
            onOpenSettings={onOpenSettings}
          />
        </aside>

        {/* Entries list — scrollable, so a long diary never stretches the page */}
        <section className="flex min-h-0 flex-col">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{book.title}</h1>
            <p className="shrink-0 text-sm text-muted-foreground">
              {query.trim()
                ? `${filteredEntries.length} of ${activeEntries.length}`
                : `${activeEntries.length} ${activeEntries.length === 1 ? "entry" : "entries"}`}
            </p>
          </div>

          {activeEntries.length > 0 && (
            <div className="relative mt-4">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by title, date, mood, tag or text…"
                className="pl-9 pr-9"
                aria-label="Search entries"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          )}

          {activeEntries.length === 0 ? (
            <div className="surface mt-6 flex flex-col items-center gap-3 p-12 text-center">
              <BookOpen className="size-10 text-muted-foreground/50" />
              <p className="text-lg font-medium">No entries yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Write the first page of this diary — it starts with a single memory.
              </p>
              <Button onClick={onNewEntry} className="gap-1.5">
                <Plus className="size-4" />
                Write first entry
              </Button>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="surface mt-6 p-10 text-center">
              <Search className="mx-auto size-6 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">No matching entries</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Nothing matches “{query.trim()}”. Try another word or a date like
                2026-09.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => setQuery("")}
              >
                Clear search
              </Button>
            </div>
          ) : (
            <ul className="mt-4 max-h-[65vh] space-y-3 overflow-y-auto overscroll-contain pb-1 pr-1 lg:max-h-[calc(100vh-15rem)]">
              {filteredEntries.map((entry) => (
                <li key={entry.id} className="surface surface-hover group p-4">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => onEdit(entry)}
                    >
                      <p className="truncate text-sm font-semibold">
                        {entry.title || "Untitled"}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {entry.plainText || "Empty entry"}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{entry.date}</span>
                        {entry.mood && <span>· {entry.mood}</span>}
                        {entry.tags.map((t) => (
                          <span key={t} className="rounded-full bg-muted px-2 py-0.5">
                            #{t}
                          </span>
                        ))}
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => onEdit(entry)} aria-label="Edit entry">
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive"
                        onClick={() => void handleDeleteEntry(entry)}
                        aria-label="Delete entry"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

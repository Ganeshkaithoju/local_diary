/**
 * EntryEditor — the writing experience.
 *
 * A clean contenteditable-based editor with a formatting toolbar, debounced
 * local autosave (IndexedDB), word/char counts, and an optional AI title
 * suggestion. Autosave never depends on the network: writes go straight to
 * the local Dexie store, so a dropped connection can never lose writing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as React from "react";
import {
  AlertCircle,
  ArrowLeft,
  Bold,
  Check,
  CheckSquare,
  ChevronDown,
  Copy,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Loader2,
  Mic,
  MicOff,
  Palette,
  Quote,
  RotateCcw,
  Sparkles,
  Strikethrough,
  Underline,
  Unlink,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PageStylePicker } from "@/features/library/PageStylePicker";
import { htmlToPlainText } from "@/diary/storage";
import { sanitizeHtml } from "@/diary/sanitize";
import {
  PAGE_STYLE_CLASS,
  effectivePageStyle,
  type DiaryEntry,
  type PageStyle,
  type SaveState,
} from "@/diary/types";
import { useDictation } from "@/features/editor/dictation";
import { type VoiceCommand } from "@/features/editor/voiceCommands";
import { RefinementPreview } from "@/features/editor/RefinementPreview";
import { resolveProvider } from "@/diary/gemini";
import { usePrefs } from "@/diary/prefs";
import { useDiaryStorage } from "@/hooks/use-diary-storage";
import { cn } from "@/lib/utils";

interface EntryEditorProps {
  bookId: string;
  entry: DiaryEntry | null;
  /** The entry written before this one, for "start from yesterday's page". */
  previousEntry?: DiaryEntry | null;
  /** The book's paper, so the writing surface matches the printed page. */
  pageStyle: PageStyle;
  pageImage: string | null;
  onPageStyleChange: (patch: {
    pageStyle?: PageStyle;
    pageImage?: string | null;
  }) => void;
  onBack: () => void;
  onSaved: (entryId: string) => void;
}

export function EntryEditor({
  bookId,
  entry,
  previousEntry,
  pageStyle,
  pageImage,
  onPageStyleChange,
  onBack,
  onSaved,
}: EntryEditorProps) {
  const storage = useDiaryStorage();
  const { prefs } = usePrefs();

  // The paper the book uses — a `custom` style without an image falls back.
  const style = effectivePageStyle({ pageStyle, pageImage });
  const styleClass = PAGE_STYLE_CLASS[style] ?? "page-lined";
  const customImage = style === "custom" ? pageImage : null;

  const [title, setTitle] = useState(entry?.title ?? "");
  const [date, setDate] = useState(entry?.date ?? todayISO());
  const [mood, setMood] = useState(entry?.mood ?? "");
  const [tags, setTags] = useState((entry?.tags ?? []).join(", "));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [wordCount, setWordCount] = useState(0);
  const [suggesting, setSuggesting] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [showRefinementPreview, setShowRefinementPreview] = useState(false);
  const [originalContentForRefine, setOriginalContentForRefine] = useState("");
  const [refinedContent, setRefinedContent] = useState("");
  /** Copy the previous entry's content/formatting into this new entry. */
  const [copiedFromPrevious, setCopiedFromPrevious] = useState(false);
  /** Voice command "key clear" confirmation modal state */
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Active formatting state tracking
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isStrike, setIsStrike] = useState(false);
  const [isBlockquote, setIsBlockquote] = useState(false);
  const [activeHeading, setActiveHeading] = useState<"p" | "h1" | "h2" | "h3" | "h4" | "h5">("p");
  const [activeListType, setActiveListType] = useState<
    "none" | "disc" | "circle" | "square" | "decimal" | "upper-alpha" | "lower-alpha" | "upper-roman" | "lower-roman" | "checklist"
  >("none");
  const [activeLinkUrl, setActiveLinkUrl] = useState<string | null>(null);
  const [headingPopoverOpen, setHeadingPopoverOpen] = useState(false);
  const [listPopoverOpen, setListPopoverOpen] = useState(false);
  const [isLinkOpen, setIsLinkOpen] = useState(false);
  const [linkInput, setLinkInput] = useState("");

  const editorRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entryIdRef = useRef<string | null>(entry?.id ?? null);
  const dirtyRef = useRef(false);
  const lastHtmlRef = useRef(entry?.contentHtml ?? "");

  // Initialize editor content once per entry.
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = entry?.contentHtml ?? "";
      lastHtmlRef.current = entry?.contentHtml ?? "";
      setWordCount(countWords(htmlToPlainText(entry?.contentHtml ?? "")));
    }
  }, [entry?.id]);

  const save = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      const html = editorRef.current?.innerHTML ?? "";
      if (!dirtyRef.current && entryIdRef.current) return;
      if (!dirtyRef.current && !entryIdRef.current && !html.trim()) return;

      const plain = htmlToPlainText(html);
      setSaveState("saving");
      try {
        if (!entryIdRef.current) {
          const created = await storage.createEntry({
            bookId,
            ownerId: storage.currentOwnerId,
            title: title.trim() || "Untitled",
            date,
            contentHtml: sanitizeHtml(html),
            plainText: plain,
            tags: tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
              .slice(0, 12),
            mood: mood.trim(),
          });
          entryIdRef.current = created.id;
        } else {
          await storage.updateEntry(entryIdRef.current, {
            title: title.trim() || "Untitled",
            date,
            contentHtml: sanitizeHtml(html),
            plainText: plain,
            tags: tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
              .slice(0, 12),
            mood: mood.trim(),
          });
        }
        dirtyRef.current = false;
        lastHtmlRef.current = html;
        setSaveState("saved");
        if (!opts.silent) toast.success("Saved to your local diary.");
      } catch {
        setSaveState("error");
        toast.error("Could not save — your words are still on screen. Try again.");
      }
    },
    [bookId, date, mood, storage, tags, title],
  );

  // Debounced autosave while typing.
  const scheduleAutosave = useCallback(() => {
    dirtyRef.current = true;
    setSaveState("typing");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void save({ silent: true });
    }, 1200);
  }, [save]);

  // Clear autosave timer when unmounting.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const updateActiveFormats = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) {
      return;
    }

    try {
      setIsBold(document.queryCommandState("bold"));
      setIsItalic(document.queryCommandState("italic"));
      setIsUnderline(document.queryCommandState("underline"));
      setIsStrike(document.queryCommandState("strikeThrough"));
    } catch {
      // ignore
    }

    let curr: Node | null = sel.anchorNode;
    let foundQuote = false;
    let foundHeading: "p" | "h1" | "h2" | "h3" | "h4" | "h5" = "p";
    let foundList: typeof activeListType = "none";
    let foundLink: string | null = null;

    while (curr && curr !== editor) {
      if (curr.nodeType === Node.ELEMENT_NODE) {
        const el = curr as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (tag === "blockquote") foundQuote = true;
        if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5") {
          foundHeading = tag as any;
        }
        if (tag === "a" && !foundLink) {
          foundLink = el.getAttribute("href");
        }
        if (tag === "ul") {
          if (el.classList.contains("diary-checklist")) {
            foundList = "checklist";
          } else {
            const styleType = el.getAttribute("data-list-style") || el.style.listStyleType || "disc";
            foundList = (styleType === "circle" || styleType === "square" ? styleType : "disc") as any;
          }
        } else if (tag === "ol") {
          const olType = el.getAttribute("type");
          const listStyle = el.style.listStyleType;
          if (olType === "A" || listStyle === "upper-alpha") foundList = "upper-alpha";
          else if (olType === "a" || listStyle === "lower-alpha") foundList = "lower-alpha";
          else if (olType === "I" || listStyle === "upper-roman") foundList = "upper-roman";
          else if (olType === "i" || listStyle === "lower-roman") foundList = "lower-roman";
          else foundList = "decimal";
        }
      }
      curr = curr.parentNode;
    }

    setIsBlockquote(foundQuote);
    setActiveHeading(foundHeading);
    setActiveListType(foundList);
    setActiveLinkUrl(foundLink);
  }, []);

  useEffect(() => {
    const handleSelectionChange = () => {
      const editor = editorRef.current;
      if (!editor) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      if (editor.contains(sel.anchorNode)) {
        updateActiveFormats();
      }
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [updateActiveFormats]);

  const saveSelection = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }, []);

  const restoreSelection = useCallback(() => {
    const range = savedRangeRef.current;
    if (!range) return;
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, []);

  const exec = (cmd: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    dirtyRef.current = true;
    scheduleAutosave();
    updateActiveFormats();
  };

  const applyHeading = (tag: "p" | "h1" | "h2" | "h3" | "h4" | "h5") => {
    editorRef.current?.focus();
    if (activeHeading === tag) {
      document.execCommand("formatBlock", false, "<p>");
    } else {
      document.execCommand("formatBlock", false, `<${tag}>`);
    }
    dirtyRef.current = true;
    scheduleAutosave();
    updateActiveFormats();
  };

  const toggleBlockquote = () => {
    editorRef.current?.focus();
    if (isBlockquote) {
      document.execCommand("formatBlock", false, "<p>");
    } else {
      document.execCommand("formatBlock", false, "<blockquote>");
    }
    dirtyRef.current = true;
    scheduleAutosave();
    updateActiveFormats();
  };

  const applyList = (type: typeof activeListType) => {
    editorRef.current?.focus();
    if (activeListType === type) {
      if (type === "checklist" || type === "disc" || type === "circle" || type === "square") {
        document.execCommand("insertUnorderedList", false);
      } else {
        document.execCommand("insertOrderedList", false);
      }
      dirtyRef.current = true;
      scheduleAutosave();
      updateActiveFormats();
      return;
    }

    if (type === "disc" || type === "circle" || type === "square") {
      if (
        activeListType === "none" ||
        activeListType === "decimal" ||
        activeListType.startsWith("upper") ||
        activeListType.startsWith("lower")
      ) {
        document.execCommand("insertUnorderedList", false);
      }
      const sel = window.getSelection();
      let curr: Node | null = sel?.anchorNode ?? null;
      let ulNode: HTMLUListElement | null = null;
      while (curr && curr !== editorRef.current) {
        if (curr.nodeType === Node.ELEMENT_NODE && (curr as HTMLElement).tagName.toLowerCase() === "ul") {
          ulNode = curr as HTMLUListElement;
          break;
        }
        curr = curr.parentNode;
      }
      if (ulNode) {
        ulNode.classList.remove("diary-checklist");
        ulNode.setAttribute("data-list-style", type);
        ulNode.style.listStyleType = type;
        ulNode.querySelectorAll("li > input[type='checkbox']").forEach((cb) => cb.remove());
        ulNode.querySelectorAll("li").forEach((li) => li.removeAttribute("data-checked"));
      }
    } else if (type === "checklist") {
      if (
        activeListType === "none" ||
        activeListType === "decimal" ||
        activeListType.startsWith("upper") ||
        activeListType.startsWith("lower")
      ) {
        document.execCommand("insertUnorderedList", false);
      }
      const sel = window.getSelection();
      let curr: Node | null = sel?.anchorNode ?? null;
      let ulNode: HTMLUListElement | null = null;
      while (curr && curr !== editorRef.current) {
        if (curr.nodeType === Node.ELEMENT_NODE && (curr as HTMLElement).tagName.toLowerCase() === "ul") {
          ulNode = curr as HTMLUListElement;
          break;
        }
        curr = curr.parentNode;
      }
      if (ulNode) {
        ulNode.classList.add("diary-checklist");
        ulNode.style.listStyleType = "none";
        ulNode.removeAttribute("data-list-style");
        ulNode.querySelectorAll("li").forEach((li) => {
          if (!li.querySelector('input[type="checkbox"]')) {
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.contentEditable = "false";
            cb.style.cursor = "pointer";
            li.prepend(cb);
            li.setAttribute("data-checked", "false");
          }
        });
      }
    } else {
      if (
        activeListType === "none" ||
        activeListType === "checklist" ||
        activeListType === "disc" ||
        activeListType === "circle" ||
        activeListType === "square"
      ) {
        document.execCommand("insertOrderedList", false);
      }
      const sel = window.getSelection();
      let curr: Node | null = sel?.anchorNode ?? null;
      let olNode: HTMLOListElement | null = null;
      while (curr && curr !== editorRef.current) {
        if (curr.nodeType === Node.ELEMENT_NODE && (curr as HTMLElement).tagName.toLowerCase() === "ol") {
          olNode = curr as HTMLOListElement;
          break;
        }
        curr = curr.parentNode;
      }
      if (olNode) {
        if (type === "upper-alpha") {
          olNode.setAttribute("type", "A");
          olNode.style.listStyleType = "upper-alpha";
        } else if (type === "lower-alpha") {
          olNode.setAttribute("type", "a");
          olNode.style.listStyleType = "lower-alpha";
        } else if (type === "upper-roman") {
          olNode.setAttribute("type", "I");
          olNode.style.listStyleType = "upper-roman";
        } else if (type === "lower-roman") {
          olNode.setAttribute("type", "i");
          olNode.style.listStyleType = "lower-roman";
        } else {
          olNode.removeAttribute("type");
          olNode.style.listStyleType = "decimal";
        }
      }
    }

    dirtyRef.current = true;
    scheduleAutosave();
    updateActiveFormats();
  };

  const ensureChecklistCheckboxes = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const checklistLis = editor.querySelectorAll("ul.diary-checklist > li");
    checklistLis.forEach((li) => {
      if (!li.querySelector('input[type="checkbox"]')) {
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.contentEditable = "false";
        cb.style.cursor = "pointer";
        li.prepend(cb);
        if (!li.hasAttribute("data-checked")) {
          li.setAttribute("data-checked", "false");
        }
      }
    });
  };

  const handleApplyLink = () => {
    const safe = normalizeUrl(linkInput);
    if (!safe) {
      toast.error("Please enter a valid web link.");
      return;
    }
    restoreSelection();
    editorRef.current?.focus();

    const sel = window.getSelection();
    if (sel && sel.anchorNode) {
      let curr: Node | null = sel.anchorNode;
      let existingAnchor: HTMLAnchorElement | null = null;
      while (curr && curr !== editorRef.current) {
        if (curr.nodeType === Node.ELEMENT_NODE && (curr as HTMLElement).tagName.toLowerCase() === "a") {
          existingAnchor = curr as HTMLAnchorElement;
          break;
        }
        curr = curr.parentNode;
      }
      if (existingAnchor) {
        existingAnchor.setAttribute("href", safe);
        existingAnchor.setAttribute("target", "_blank");
        existingAnchor.setAttribute("rel", "noopener noreferrer");
        existingAnchor.title = "Ctrl+Click to open link";
        setIsLinkOpen(false);
        dirtyRef.current = true;
        scheduleAutosave();
        updateActiveFormats();
        toast.success("Link updated.");
        return;
      }
    }

    if (sel && sel.isCollapsed) {
      document.execCommand(
        "insertHTML",
        false,
        `<a href="${safe}" target="_blank" rel="noopener noreferrer" title="Ctrl+Click to open link">${safe}</a>`,
      );
    } else {
      document.execCommand("createLink", false, safe);
      if (editorRef.current) {
        const anchors = editorRef.current.querySelectorAll("a");
        anchors.forEach((a) => {
          if (a.getAttribute("href") === safe) {
            a.setAttribute("target", "_blank");
            a.setAttribute("rel", "noopener noreferrer");
            a.title = "Ctrl+Click to open link";
          }
        });
      }
    }
    setIsLinkOpen(false);
    dirtyRef.current = true;
    scheduleAutosave();
    updateActiveFormats();
    toast.success("Link added.");
  };

  const handleRemoveLink = () => {
    restoreSelection();
    editorRef.current?.focus();
    document.execCommand("unlink", false);
    setIsLinkOpen(false);
    dirtyRef.current = true;
    scheduleAutosave();
    updateActiveFormats();
    toast.info("Link removed.");
  };

  const handleEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    // Toggle checklist checkbox
    if (target && target.tagName === "INPUT" && (target as HTMLInputElement).type === "checkbox") {
      const cb = target as HTMLInputElement;
      const li = cb.closest("li");
      if (li) {
        li.setAttribute("data-checked", cb.checked ? "true" : "false");
        dirtyRef.current = true;
        scheduleAutosave();
      }
      return;
    }

    // Ctrl/Cmd + click on link to open in new tab
    if (e.ctrlKey || e.metaKey) {
      const anchor = target.closest("a");
      if (anchor && anchor.href) {
        e.preventDefault();
        window.open(anchor.href, "_blank", "noopener,noreferrer");
        return;
      }
    }

    updateActiveFormats();
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      saveSelection();
      setLinkInput(activeLinkUrl || "");
      setIsLinkOpen(true);
      return;
    }
  };

  /**
   * Drop a dictated chunk onto the page at the caret — or at the end of the
   * page when the caret is elsewhere, so speech keeps flowing into the entry
   * rather than stopping. The synthetic `input` event pushes the new text
   * through the editor's own word count and autosave pipeline.
   */
  const insertDictatedText = useCallback((text: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    const caretInEditor =
      !!selection &&
      selection.rangeCount > 0 &&
      editor.contains(selection.anchorNode);
    if (!caretInEditor && selection) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    document.execCommand("insertText", false, `${text} `);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }, []);

  const handleConfirmClear = () => {
    const editor = editorRef.current;
    if (editor) {
      editor.focus();
      document.execCommand("selectAll", false);
      document.execCommand("delete", false);
      editor.innerHTML = "";
      setWordCount(0);
      dirtyRef.current = true;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      scheduleAutosave();
      toast.success("Entry content cleared.");
    }
    setShowClearConfirm(false);
  };

  const handleVoiceCommand = useCallback(
    (cmd: VoiceCommand) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();

      if (cmd.type === "BACKSPACE" || (cmd.type as string) === "backspace") {
        const selection = window.getSelection();
        if (!selection) return;

        const caretInEditor =
          selection.rangeCount > 0 && editor.contains(selection.anchorNode);
        if (!caretInEditor) {
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }

        // If user has a selected range, delete it
        if (!selection.isCollapsed) {
          document.execCommand("delete", false);
        } else {
          // Extend selection backward to previous word
          const selWithModify = selection as unknown as {
            modify?: (alter: string, direction: string, granularity: string) => void;
          };
          if (typeof selWithModify.modify === "function") {
            selWithModify.modify("extend", "backward", "word");
            // If only trailing whitespace/punctuation was selected, extend once more to select the word
            if (/^[\s.,!?;:–—]+$/.test(selection.toString())) {
              selWithModify.modify("extend", "backward", "word");
            }
          }
          document.execCommand("delete", false);
        }

        editor.dispatchEvent(new Event("input", { bubbles: true }));
        scheduleAutosave();
        toast.info("⌨ Backspace — removed last word", { duration: 1500 });
      } else if (
        cmd.type === "ENTER" ||
        cmd.type === "NEW_PARAGRAPH" ||
        (cmd.type as string) === "new-paragraph"
      ) {
        document.execCommand("insertParagraph", false);
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        scheduleAutosave();
        toast.info("↵ Enter — new line", { duration: 1500 });
      } else if (cmd.type === "DELETE_SENTENCE") {
        const selection = window.getSelection();
        if (!selection) return;

        const caretInEditor =
          selection.rangeCount > 0 && editor.contains(selection.anchorNode);
        if (!caretInEditor) {
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }

        const currentRange = selection.getRangeAt(0);
        const preRange = document.createRange();
        preRange.selectNodeContents(editor);
        try {
          preRange.setEnd(currentRange.startContainer, currentRange.startOffset);
        } catch {
          // fallback
        }
        const textBefore = preRange.toString();
        const sentenceLen = findPreviousSentenceLength(textBefore);

        if (sentenceLen > 0) {
          const ok = selectBackwardCharacters(editor, sentenceLen);
          if (ok) {
            document.execCommand("delete", false);
          }
        }

        editor.dispatchEvent(new Event("input", { bubbles: true }));
        scheduleAutosave();
        toast.info("⌫ Delete — removed previous sentence", { duration: 1500 });
      } else if (cmd.type === "CLEAR") {
        setShowClearConfirm(true);
        toast.info("🗑 Clear — awaiting confirmation", { duration: 2000 });
      } else if (cmd.type === "UNDO" || (cmd.type as string) === "undo") {
        document.execCommand("undo", false);
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        scheduleAutosave();
        toast.info("↶ Undo", { duration: 1500 });
      } else if (cmd.type === "REDO" || (cmd.type as string) === "redo") {
        document.execCommand("redo", false);
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        scheduleAutosave();
        toast.info("↷ Redo", { duration: 1500 });
      }
    },
    [scheduleAutosave],
  );

  const dictation = useDictation(insertDictatedText, handleVoiceCommand);

  const suggestTitle = async () => {
    const html = editorRef.current?.innerHTML ?? "";
    const text = htmlToPlainText(html);
    if (!text.trim()) {
      toast.error("Write something first, then ask for a title idea.");
      return;
    }
    if (!prefs.geminiApiKey) {
      toast.error("Add your Gemini API key in Settings to use AI helpers.");
      return;
    }
    setSuggesting(true);
    try {
      const provider = resolveProvider();
      const suggestion = await provider.suggestTitle(text, prefs.geminiApiKey);
      setTitle(suggestion.replace(/^["']|["']$/g, "").slice(0, 80));
      dirtyRef.current = true;
      toast.success("Title suggested.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI request failed.");
    } finally {
      setSuggesting(false);
    }
  };

  const refineNote = async () => {
    const html = editorRef.current?.innerHTML ?? "";
    const text = htmlToPlainText(html).trim();
    if (!text) {
      toast.error("Write something first before refining.");
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      toast.error("Gemini refinement is unavailable while offline.");
      return;
    }
    if (!prefs.geminiApiKey) {
      toast.error("Add your Gemini API key in Settings to use AI helpers.");
      return;
    }
    if (isRefining) return;

    setIsRefining(true);
    setOriginalContentForRefine(text);
    try {
      const provider = resolveProvider();
      const refined = await provider.refineNote(text, prefs.geminiApiKey);
      setRefinedContent(refined);
      setShowRefinementPreview(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI refinement failed.";
      toast.error(`Unable to refine the note right now: ${msg}. Your original note is unchanged.`);
    } finally {
      setIsRefining(false);
    }
  };

  const handleAcceptRefinement = () => {
    if (!editorRef.current || !refinedContent) return;

    // Convert refined plain text into clean HTML paragraphs
    const paragraphs = refinedContent
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    const newHtml =
      paragraphs.length > 0
        ? paragraphs.map((p) => `<p>${sanitizeHtml(p)}</p>`).join("")
        : `<p>${sanitizeHtml(refinedContent)}</p>`;

    editorRef.current.innerHTML = newHtml;
    lastHtmlRef.current = newHtml;
    setWordCount(countWords(refinedContent));
    dirtyRef.current = true;
    scheduleAutosave();

    setShowRefinementPreview(false);
    setRefinedContent("");
    setOriginalContentForRefine("");
    toast.success("Refined note accepted.");
  };

  const handleDeclineRefinement = () => {
    setShowRefinementPreview(false);
    setRefinedContent("");
    setOriginalContentForRefine("");
    toast.info("Original note kept.");
  };

  const saveStateLabel: Record<SaveState, string> = {
    idle: "",
    typing: "Unsaved changes",
    saving: "Saving…",
    saved: "Saved locally",
    error: "Save failed",
  };

  /**
   * Copy the previous entry (title, mood, tags, formatted content) into this
   * one — for daily templates where only the details change. The date stays
   * today and the copy becomes this entry's own editable content.
   */
  const copyPrevious = useCallback(async () => {
    if (!previousEntry || entryIdRef.current) return;
    const html = previousEntry.contentHtml || "";
    if (editorRef.current) {
      editorRef.current.innerHTML = html;
      lastHtmlRef.current = html;
    }
    setTitle(previousEntry.title || "");
    setMood(previousEntry.mood || "");
    setTags((previousEntry.tags ?? []).join(", "));
    setWordCount(countWords(htmlToPlainText(html)));
    setCopiedFromPrevious(true);
    // Persist immediately so nothing is lost if the user leaves.
    dirtyRef.current = true;
    await save({ silent: true });
    toast.success(
      `Copied “${previousEntry.title || "Untitled"}” — edit the details for today.`,
    );
  }, [previousEntry, save]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={onSaveAndBack} className="gap-1.5">
              <ArrowLeft className="size-4" />
              Back to book
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Return to the book reader
          </TooltipContent>
        </Tooltip>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "text-xs",
              saveState === "error"
                ? "text-destructive"
                : saveState === "saved"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground",
            )}
            role="status"
          >
            {saveStateLabel[saveState]}
          </span>
          {/* Change the paper while writing — the choice is the book's, so it
              applies to every entry and the printed pages too. */}
          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    aria-label="Change page style"
                  >
                    <Palette className="size-4" />
                    Paper
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Change paper texture and style
              </TooltipContent>
            </Tooltip>
            <PopoverContent align="end" className="w-[19rem]">
              <p className="text-sm font-medium">Page style</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Applies to this book — every entry and every printed page.
              </p>
              <PageStylePicker
                value={style}
                pageImage={pageImage}
                onChange={(next) => onPageStyleChange({ pageStyle: next })}
                onPickImage={(img) => onPageStyleChange({ pageImage: img })}
                compact
                className="mt-3"
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Copy previous entry — only while this entry is still blank/new */}
      {!entry && previousEntry && !copiedFromPrevious && (
        <button
          type="button"
          onClick={() => void copyPrevious()}
          className="surface surface-hover group flex w-full items-center gap-3 p-3 text-left"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
            <Copy className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">
              Start from the previous entry
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              Copies “{previousEntry.title || "Untitled"}” — formatting included — then edit today's details.
            </span>
          </span>
        </button>
      )}

      {/* Title + date + mood */}
      <div className="surface p-5">
        <Input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            scheduleAutosave();
          }}
          placeholder="Entry title…"
          className="border-none bg-transparent px-0 text-xl font-semibold shadow-none focus-visible:ring-0"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <Input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              scheduleAutosave();
            }}
            className="w-auto"
          />
          <Input
            value={mood}
            onChange={(e) => {
              setMood(e.target.value);
              scheduleAutosave();
            }}
            placeholder="Mood…"
            className="w-28"
          />
          <Input
            value={tags}
            onChange={(e) => {
              setTags(e.target.value);
              scheduleAutosave();
            }}
            placeholder="tags, comma separated"
            className="w-44"
          />
        </div>
      </div>

      {/* Toolbar */}
      <div className="surface flex flex-wrap items-center gap-1 p-1.5">
        <TooltipButton
          onClick={() => exec("bold")}
          label="Bold"
          tooltip="Bold"
          shortcut="Ctrl+B"
          isActive={isBold}
        >
          <Bold className="size-4" />
        </TooltipButton>
        <TooltipButton
          onClick={() => exec("italic")}
          label="Italic"
          tooltip="Italic"
          shortcut="Ctrl+I"
          isActive={isItalic}
        >
          <Italic className="size-4" />
        </TooltipButton>
        <TooltipButton
          onClick={() => exec("underline")}
          label="Underline"
          tooltip="Underline"
          shortcut="Ctrl+U"
          isActive={isUnderline}
        >
          <Underline className="size-4" />
        </TooltipButton>
        <TooltipButton
          onClick={() => exec("strikeThrough")}
          label="Strikethrough"
          tooltip="Strikethrough"
          isActive={isStrike}
        >
          <Strikethrough className="size-4" />
        </TooltipButton>

        <div className="mx-0.5 h-4 w-px bg-border/80" />

        {/* Heading Popover / Dropdown */}
        <Popover open={headingPopoverOpen} onOpenChange={setHeadingPopoverOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    saveSelection();
                  }}
                  className={cn(
                    "h-8 gap-1 px-2 text-xs font-medium",
                    activeHeading !== "p" && "bg-primary/15 text-primary font-semibold",
                  )}
                  aria-label="Text style and headings"
                >
                  <span>{activeHeading === "p" ? "Normal" : activeHeading.toUpperCase()}</span>
                  <ChevronDown className="size-3 opacity-60" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Headings (H1–H5, Normal)
            </TooltipContent>
          </Tooltip>
          <PopoverContent align="start" className="w-56 p-1.5 shadow-lg">
            <div className="space-y-0.5">
              {HEADING_OPTIONS.map((item) => (
                <button
                  key={item.tag}
                  type="button"
                  onClick={() => {
                    setHeadingPopoverOpen(false);
                    restoreSelection();
                    applyHeading(item.tag);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted",
                    activeHeading === item.tag && "bg-primary/10 font-semibold text-primary",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-6 font-mono text-[11px] text-muted-foreground">
                      {item.shortcut}
                    </span>
                    <span>{item.label}</span>
                  </div>
                  {activeHeading === item.tag && <Check className="size-3.5 text-primary" />}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* List Menu Popover */}
        <Popover open={listPopoverOpen} onOpenChange={setListPopoverOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    saveSelection();
                  }}
                  className={cn(
                    "size-8",
                    activeListType !== "none" && "bg-primary/15 text-primary hover:bg-primary/20",
                  )}
                  aria-label="Lists and checklists"
                >
                  {activeListType === "checklist" ? (
                    <CheckSquare className="size-4" />
                  ) : activeListType === "decimal" ||
                    activeListType.startsWith("upper") ||
                    activeListType.startsWith("lower") ? (
                    <ListOrdered className="size-4" />
                  ) : (
                    <List className="size-4" />
                  )}
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Lists &amp; Checklists
            </TooltipContent>
          </Tooltip>
          <PopoverContent align="start" className="w-64 p-2 space-y-2 shadow-lg">
            <div>
              <p className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Bullet Lists
              </p>
              <div className="mt-1 grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setListPopoverOpen(false);
                    restoreSelection();
                    applyList("disc");
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center rounded border border-border/50 p-1.5 text-xs hover:bg-muted transition-colors",
                    activeListType === "disc" && "border-primary bg-primary/10 text-primary font-semibold",
                  )}
                >
                  <span className="text-sm leading-none">•</span>
                  <span className="mt-1 text-[10px]">Bullet</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setListPopoverOpen(false);
                    restoreSelection();
                    applyList("circle");
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center rounded border border-border/50 p-1.5 text-xs hover:bg-muted transition-colors",
                    activeListType === "circle" && "border-primary bg-primary/10 text-primary font-semibold",
                  )}
                >
                  <span className="text-sm leading-none">○</span>
                  <span className="mt-1 text-[10px]">Circle</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setListPopoverOpen(false);
                    restoreSelection();
                    applyList("square");
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center rounded border border-border/50 p-1.5 text-xs hover:bg-muted transition-colors",
                    activeListType === "square" && "border-primary bg-primary/10 text-primary font-semibold",
                  )}
                >
                  <span className="text-sm leading-none">▪</span>
                  <span className="mt-1 text-[10px]">Square</span>
                </button>
              </div>
            </div>

            <div className="border-t border-border/50 pt-1.5">
              <p className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Numbered Lists
              </p>
              <div className="mt-1 grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setListPopoverOpen(false);
                    restoreSelection();
                    applyList("decimal");
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center rounded border border-border/50 p-1.5 text-xs hover:bg-muted transition-colors",
                    activeListType === "decimal" && "border-primary bg-primary/10 text-primary font-semibold",
                  )}
                >
                  <span className="font-mono text-xs">1, 2, 3</span>
                  <span className="mt-1 text-[10px]">Numbers</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setListPopoverOpen(false);
                    restoreSelection();
                    applyList("upper-alpha");
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center rounded border border-border/50 p-1.5 text-xs hover:bg-muted transition-colors",
                    activeListType === "upper-alpha" && "border-primary bg-primary/10 text-primary font-semibold",
                  )}
                >
                  <span className="font-mono text-xs">A, B, C</span>
                  <span className="mt-1 text-[10px]">A-Z</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setListPopoverOpen(false);
                    restoreSelection();
                    applyList("lower-alpha");
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center rounded border border-border/50 p-1.5 text-xs hover:bg-muted transition-colors",
                    activeListType === "lower-alpha" && "border-primary bg-primary/10 text-primary font-semibold",
                  )}
                >
                  <span className="font-mono text-xs">a, b, c</span>
                  <span className="mt-1 text-[10px]">a-z</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setListPopoverOpen(false);
                    restoreSelection();
                    applyList("upper-roman");
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center rounded border border-border/50 p-1.5 text-xs hover:bg-muted transition-colors",
                    activeListType === "upper-roman" && "border-primary bg-primary/10 text-primary font-semibold",
                  )}
                >
                  <span className="font-mono text-xs">I, II, III</span>
                  <span className="mt-1 text-[10px]">I-XII</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setListPopoverOpen(false);
                    restoreSelection();
                    applyList("lower-roman");
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center rounded border border-border/50 p-1.5 text-xs hover:bg-muted transition-colors",
                    activeListType === "lower-roman" && "border-primary bg-primary/10 text-primary font-semibold",
                  )}
                >
                  <span className="font-mono text-xs">i, ii, iii</span>
                  <span className="mt-1 text-[10px]">i-xii</span>
                </button>
              </div>
            </div>

            <div className="border-t border-border/50 pt-1.5">
              <button
                type="button"
                onClick={() => {
                  setListPopoverOpen(false);
                  restoreSelection();
                  applyList("checklist");
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded border border-border/50 px-2.5 py-1.5 text-xs hover:bg-muted transition-colors",
                  activeListType === "checklist" && "border-primary bg-primary/10 text-primary font-semibold",
                )}
              >
                <div className="flex items-center gap-2">
                  <CheckSquare className="size-4" />
                  <span>Interactive Checklist</span>
                </div>
                {activeListType === "checklist" && <Check className="size-3.5 text-primary" />}
              </button>
            </div>
          </PopoverContent>
        </Popover>

        {/* Hyperlink Popover */}
        <Popover
          open={isLinkOpen}
          onOpenChange={(open) => {
            if (open) {
              saveSelection();
              setLinkInput(activeLinkUrl || "");
            }
            setIsLinkOpen(open);
          }}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    saveSelection();
                  }}
                  className={cn(
                    "size-8",
                    activeLinkUrl && "bg-primary/15 text-primary hover:bg-primary/20",
                  )}
                  aria-label="Insert or edit link (Ctrl+K)"
                >
                  <LinkIcon className="size-4" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="flex items-center gap-1.5 text-xs">
              <span>Insert or edit link</span>
              <kbd className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">Ctrl+K</kbd>
            </TooltipContent>
          </Tooltip>
          <PopoverContent align="start" className="w-80 p-3 space-y-3 shadow-lg">
            <div>
              <p className="text-xs font-semibold">{activeLinkUrl ? "Edit Link" : "Insert Link"}</p>
              <p className="text-[11px] text-muted-foreground">Ctrl+Click in the editor opens link</p>
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                placeholder="https://example.com"
                className="h-8 text-xs"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleApplyLink();
                  }
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              {activeLinkUrl ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleRemoveLink}
                >
                  Remove
                </Button>
              ) : (
                <div />
              )}
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setIsLinkOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-xs font-medium"
                  onClick={handleApplyLink}
                >
                  Save
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Blockquote */}
        <TooltipButton
          onClick={toggleBlockquote}
          label="Quote"
          tooltip="Blockquote"
          isActive={isBlockquote}
        >
          <Quote className="size-4" />
        </TooltipButton>

        <div className="mx-1 h-5 w-px bg-border" />
        {/* Voice dictation with tooltip and status states */}
        <Tooltip>
          <TooltipTrigger asChild>
            <ToolbarButton
              onClick={dictation.toggle}
              label={
                !dictation.supported
                  ? "Voice dictation needs Chrome, Edge or Safari"
                  : dictation.status === "listening"
                    ? "Stop voice typing"
                    : dictation.status === "recovering"
                      ? "Reconnecting voice typing…"
                      : dictation.status === "error"
                        ? "Voice typing disconnected — click to retry"
                        : "Convert your speech to text using mic"
              }
              disabled={!dictation.supported}
              className={cn(
                dictation.status === "listening" && "bg-destructive/10 text-destructive",
                dictation.status === "recovering" && "bg-primary/10 text-primary",
                dictation.status === "error" && "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20",
              )}
            >
              {dictation.status === "listening" ? (
                <MicOff className="size-4" />
              ) : dictation.status === "recovering" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : dictation.status === "error" ? (
                <Mic className="size-4 text-amber-500" />
              ) : (
                <Mic className="size-4" />
              )}
            </ToolbarButton>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            align="center"
            className="max-w-xs rounded-lg border border-border/80 bg-popover/95 backdrop-blur-md p-3 text-popover-foreground shadow-lg space-y-2.5"
          >
            <p className="font-medium text-xs text-foreground leading-snug">
              Convert your speech to text using mic.
            </p>
            <div className="border-t border-border/60 pt-2 space-y-1.5 text-[11px]">
              <p className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
                Voice keyboard commands:
              </p>
              <div className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1.5 font-mono items-center">
                <code className="bg-muted/80 px-1.5 py-0.5 rounded text-primary font-semibold text-[11px]">
                  key backspace
                </code>
                <span className="font-sans text-muted-foreground">Remove last word</span>

                <code className="bg-muted/80 px-1.5 py-0.5 rounded text-primary font-semibold text-[11px]">
                  key enter
                </code>
                <span className="font-sans text-muted-foreground">New line</span>

                <code className="bg-muted/80 px-1.5 py-0.5 rounded text-primary font-semibold text-[11px]">
                  key delete
                </code>
                <span className="font-sans text-muted-foreground">Remove last sentence</span>

                <code className="bg-muted/80 px-1.5 py-0.5 rounded text-primary font-semibold text-[11px]">
                  key clear
                </code>
                <span className="font-sans text-muted-foreground">Clear entire entry (confirms)</span>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
        <div className="mx-1 h-5 w-px bg-border" />
        <TooltipButton
          onClick={suggestTitle}
          label="AI title suggestion"
          tooltip="AI title suggestion"
          disabled={suggesting}
        >
          <Sparkles className={cn("size-4", suggesting && "animate-pulse")} />
        </TooltipButton>
        <TooltipButton
          onClick={refineNote}
          label={
            isRefining
              ? "Gemini is refining your note…"
              : "Refine note with Gemini"
          }
          tooltip="Refine note with Gemini"
          disabled={isRefining}
          aria-label="Refine note with Gemini"
          className={isRefining ? "bg-primary/10 text-primary" : undefined}
        >
          <Wand2 className={cn("size-4", isRefining && "animate-spin text-primary")} />
        </TooltipButton>
      </div>

      {/* Live dictation status, recovery, or non-blocking error */}
      {dictation.status === "listening" && (
        <div
          role="status"
          aria-live="polite"
          className="surface flex items-center gap-3 border-primary/30 px-4 py-2.5"
        >
          <span className="relative flex size-2.5 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive/70" />
            <span className="relative inline-flex size-2.5 rounded-full bg-destructive" />
          </span>
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {dictation.interim ||
              "Listening — speak and your words are written onto this page."}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 text-xs"
            onClick={dictation.stop}
          >
            Stop
          </Button>
        </div>
      )}

      {dictation.status === "recovering" && (
        <div
          role="status"
          aria-live="polite"
          className="surface flex items-center gap-3 border-primary/40 bg-primary/5 px-4 py-2.5"
        >
          <Loader2 className="size-3.5 animate-spin text-primary shrink-0" />
          <p className="min-w-0 flex-1 text-xs text-foreground">
            Reconnecting to speech service… <span className="text-muted-foreground">(Your existing text is safe)</span>
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 text-xs"
            onClick={dictation.stop}
          >
            Cancel
          </Button>
        </div>
      )}

      {dictation.status === "error" && (
        <div
          role="alert"
          className="surface flex items-center justify-between gap-3 border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-foreground"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="size-4 shrink-0 text-amber-500" />
            <p className="truncate">
              Voice typing temporarily lost its connection. <span className="text-muted-foreground">Your existing text is safe.</span>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-7 gap-1 text-xs font-medium"
              onClick={dictation.retry}
            >
              <RotateCcw className="size-3" />
              Retry
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
              onClick={dictation.stop}
              aria-label="Dismiss error"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Writing surface — the book's own paper, so what you write on is the
          page you will read and print. An uploaded page image lives on its own
          layer rather than as an inline style here, exactly as in the reader. */}
      <div
        className={cn(
          "paper surface relative min-h-[55vh] overflow-hidden rounded-xl p-8 sm:p-10 focus-within:ring-1 focus-within:ring-ring/40",
          styleClass,
        )}
      >
        {customImage && (
          <>
            <div
              className="page-image-layer"
              style={{ backgroundImage: `url(${customImage})` }}
              aria-hidden
            />
            <div className="page-image-veil pointer-events-none absolute inset-0" aria-hidden />
          </>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Diary entry content"
          className="diary-content relative z-10 min-h-[50vh] text-[15px] leading-8 text-ink outline-none"
          onClick={handleEditorClick}
          onKeyDown={handleEditorKeyDown}
          onKeyUp={() => {
            ensureChecklistCheckboxes();
            updateActiveFormats();
          }}
          onMouseUp={updateActiveFormats}
          onInput={(e) => {
            ensureChecklistCheckboxes();
            setWordCount(countWords(htmlToPlainText(e.currentTarget.innerHTML)));
            scheduleAutosave();
          }}
          onBlur={() => {
            if (dirtyRef.current) void save({ silent: true });
          }}
        />
        {wordCount === 0 && (
          <p className="pointer-events-none absolute left-8 top-8 z-10 max-w-[90%] text-sm italic text-ink-soft sm:left-10 sm:top-10">
            Start writing… today&apos;s memory belongs on this page.
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {wordCount} words
        </p>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" onClick={onSaveAndBack}>
                <Check className="size-4" />
                Save &amp; close
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Save all changes and return to book
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <RefinementPreview
        open={showRefinementPreview}
        isRefining={isRefining}
        originalText={originalContentForRefine}
        refinedText={refinedContent}
        onAccept={handleAcceptRefinement}
        onDecline={handleDeclineRefinement}
      />

      {/* Voice command "key clear" confirmation dialog */}
      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear this diary entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all text currently written in this entry.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowClearConfirm(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmClear}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Clear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  async function onSaveAndBack() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    dirtyRef.current = true;
    await save({ silent: false });
    onSaved(entryIdRef.current ?? "");
    onBack();
  }
}

const ToolbarButton = React.forwardRef<
  HTMLButtonElement,
  {
    onClick?: () => void;
    label: string;
    children: React.ReactNode;
    disabled?: boolean;
    className?: string;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ onClick, label, children, disabled, className, ...props }, ref) => {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon"
      className={cn("size-8", className)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      {...props}
    >
      {children}
    </Button>
  );
});
ToolbarButton.displayName = "ToolbarButton";

/**
 * Finds the character length of the last complete sentence in the text preceding the caret.
 */
function findPreviousSentenceLength(text: string): number {
  if (!text) return 0;
  // Strip trailing whitespace to locate where the sentence ends
  const trimmedEnd = text.replace(/[\s\u00A0]+$/, "");
  if (!trimmedEnd) return text.length;

  // Search backward for preceding sentence boundary (. ! ? or newline)
  let boundaryIndex = -1;
  for (let i = trimmedEnd.length - 1; i >= 0; i--) {
    const ch = trimmedEnd[i];
    if ((ch === "." || ch === "!" || ch === "?" || ch === "\n") && i < trimmedEnd.length - 1) {
      boundaryIndex = i;
      break;
    }
  }

  if (boundaryIndex === -1) {
    // Entire text preceding caret is a single sentence
    return text.length;
  }

  // Sentence starts after the boundary character and any following whitespace
  let sentenceStart = boundaryIndex + 1;
  while (sentenceStart < text.length && /[\s\u00A0]/.test(text[sentenceStart])) {
    sentenceStart++;
  }

  return text.length - sentenceStart;
}

/**
 * Extends the selection backwards from the current caret by `charCount` characters across DOM text nodes.
 */
function selectBackwardCharacters(editor: HTMLElement, charCount: number): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || charCount <= 0) return false;
  const currentRange = selection.getRangeAt(0);

  const preRange = document.createRange();
  preRange.selectNodeContents(editor);
  try {
    preRange.setEnd(currentRange.startContainer, currentRange.startOffset);
  } catch {
    return false;
  }

  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let curr: Node | null = walker.nextNode();
  while (curr) {
    if (preRange.isPointInRange(curr, 0) || curr === currentRange.startContainer) {
      textNodes.push(curr as Text);
    }
    curr = walker.nextNode();
  }

  let remaining = charCount;
  let startNode: Node = currentRange.startContainer;
  let startOffset: number = currentRange.startOffset;

  for (let i = textNodes.length - 1; i >= 0; i--) {
    const node = textNodes[i];
    const nodeMax = node === currentRange.startContainer ? currentRange.startOffset : (node.textContent?.length ?? 0);
    if (nodeMax >= remaining) {
      startNode = node;
      startOffset = nodeMax - remaining;
      remaining = 0;
      break;
    } else {
      remaining -= nodeMax;
    }
  }

  const newRange = document.createRange();
  newRange.setStart(startNode, startOffset);
  newRange.setEnd(currentRange.startContainer, currentRange.startOffset);
  selection.removeAllRanges();
  selection.addRange(newRange);
  return true;
}

function countWords(text: string): number {
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function normalizeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^(javascript|data|vbscript):/i.test(trimmed)) return null;
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*?:/.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

const HEADING_OPTIONS = [
  { tag: "p", label: "Normal text", shortcut: "¶", desc: "Regular paragraph" },
  { tag: "h1", label: "Heading 1", shortcut: "H1", desc: "Main title" },
  { tag: "h2", label: "Heading 2", shortcut: "H2", desc: "Major section" },
  { tag: "h3", label: "Heading 3", shortcut: "H3", desc: "Subsection" },
  { tag: "h4", label: "Heading 4", shortcut: "H4", desc: "Minor header" },
  { tag: "h5", label: "Heading 5", shortcut: "H5", desc: "Small heading" },
] as const;

const TooltipButton = React.forwardRef<
  HTMLButtonElement,
  {
    tooltip: string;
    shortcut?: string;
    isActive?: boolean;
  } & React.ComponentProps<typeof ToolbarButton>
>(({ tooltip, shortcut, isActive, className, ...props }, ref) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ToolbarButton
          ref={ref}
          className={cn(
            isActive && "bg-primary/20 text-primary font-semibold hover:bg-primary/25",
            className,
          )}
          {...props}
        />
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex items-center gap-1.5 text-xs">
        <span>{tooltip}</span>
        {shortcut && (
          <kbd className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
            {shortcut}
          </kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
});
TooltipButton.displayName = "TooltipButton";

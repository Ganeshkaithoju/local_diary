/**
 * Voice Command Parser for Local Diary Core.
 *
 * Distinguishes natural editing commands from standard speech dictation.
 * Explicit commands use the "key <action>" syntax (e.g. "key backspace", "key enter",
 * "key delete", "key clear") to prevent false positives during normal conversation.
 */

export type VoiceCommandType =
  | "BACKSPACE"
  | "ENTER"
  | "DELETE_SENTENCE"
  | "CLEAR"
  | "NEW_PARAGRAPH"
  | "UNDO"
  | "REDO";

export interface VoiceCommand {
  type: VoiceCommandType;
  raw: string;
}

export interface VoiceParseResult {
  /** Normal dictated text that preceded the command in the same phrase */
  textBefore?: string;
  /** The recognized editing command */
  command?: VoiceCommand;
}

/**
 * Normalizes command text by trimming, collapsing spaces, and stripping trailing punctuation.
 */
export function normalizeCommandText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.!?…,:;]+$/, "")
    .replace(/\s+/g, " ");
}

/**
 * Parses raw speech transcript chunks to identify explicit keyboard commands
 * ("key <action>") or standalone legacy editing commands without breaking normal dictation.
 */
export function parseVoiceInput(rawTranscript: string): VoiceParseResult {
  if (!rawTranscript || !rawTranscript.trim()) return {};

  const trimmed = rawTranscript.trim();

  // Explicit "key <action>" pattern at the end of phrase or standalone
  // Example: "Today I went to college key Backspace" or "key Enter"
  const keyRegex = /\bkey\s+(backspace|back\s+space|delete\s+last\s+word|enter|return|delete|clear|new\s+paragraph|next\s+paragraph|undo|redo)[.!?…,:;]*$/i;
  const match = trimmed.match(keyRegex);

  if (match && match.index !== undefined) {
    const rawMatched = match[0];
    const cmdAction = match[1].toLowerCase().replace(/\s+/g, " ");
    const textBefore = trimmed.slice(0, match.index).trim();

    let type: VoiceCommandType;
    if (cmdAction === "backspace" || cmdAction === "back space" || cmdAction === "delete last word") {
      type = "BACKSPACE";
    } else if (cmdAction === "enter" || cmdAction === "return") {
      type = "ENTER";
    } else if (cmdAction === "delete") {
      type = "DELETE_SENTENCE";
    } else if (cmdAction === "clear") {
      type = "CLEAR";
    } else if (cmdAction === "new paragraph" || cmdAction === "next paragraph") {
      type = "NEW_PARAGRAPH";
    } else if (cmdAction === "undo") {
      type = "UNDO";
    } else if (cmdAction === "redo") {
      type = "REDO";
    } else {
      return { textBefore: trimmed };
    }

    return {
      textBefore: textBefore || undefined,
      command: {
        type,
        raw: rawMatched,
      },
    };
  }

  // Standalone natural commands (only when the entire transcript is the command)
  const clean = normalizeCommandText(trimmed);

  if (
    clean === "backspace" ||
    clean === "back space" ||
    clean === "delete last word" ||
    clean === "remove last word" ||
    clean === "erase last word"
  ) {
    return { command: { type: "BACKSPACE", raw: rawTranscript } };
  }

  if (clean === "new paragraph" || clean === "next paragraph") {
    return { command: { type: "NEW_PARAGRAPH", raw: rawTranscript } };
  }

  if (clean === "undo" || clean === "undo that") {
    return { command: { type: "UNDO", raw: rawTranscript } };
  }

  if (clean === "redo" || clean === "redo that") {
    return { command: { type: "REDO", raw: rawTranscript } };
  }

  return { textBefore: trimmed };
}

/**
 * Backward compatibility parser for single standalone command check.
 */
export function parseVoiceCommand(rawTranscript: string): VoiceCommand | null {
  const result = parseVoiceInput(rawTranscript);
  if (!result.textBefore && result.command) {
    return result.command;
  }
  return null;
}

/**
 * Voice dictation for the writer.
 *
 * Uses the browser's own Web Speech API, so it needs no API key, no server and
 * no account — which keeps the diary local-first. The trade-off is that the
 * transcription itself is performed by the browser's speech service (Chrome
 * and Edge stream the audio to that service, so dictation is the one writing
 * feature that needs a connection); nothing is ever sent to this app's own
 * backend, and no diary text is uploaded.
 *
 * Speech results arrive in chunks: interim text while you are still speaking,
 * and a final result when the recogniser settles on a phrase. Only final
 * chunks are written onto the page — `polishTranscript` then fixes the things
 * dictation reliably gets wrong (lower-case "i", missing sentence capitals and
 * missing end punctuation) so the page reads like writing rather than a
 * transcript.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { parseVoiceInput, type VoiceCommand } from "./voiceCommands";

/* ------------------------------------------------ minimal Web Speech types
   `SpeechRecognition` is not part of TypeScript's DOM lib (only its result
   types are), and Safari still ships it prefixed, so the surface we use is
   declared here. */
interface DictationAlternative {
  transcript: string;
}
interface DictationResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: DictationAlternative;
}
interface DictationResultList {
  readonly length: number;
  readonly [index: number]: DictationResult;
}
interface DictationEvent {
  readonly resultIndex: number;
  readonly results: DictationResultList;
}
interface DictationRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: DictationEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type DictationCtor = new () => DictationRecognition;

function getRecognitionCtor(): DictationCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: DictationCtor;
    webkitSpeechRecognition?: DictationCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/* --------------------------------------------------------------- polishing */

/**
 * Turn a raw dictation chunk into something that reads like typed English:
 * tidy the spacing, capitalise the sentence start and every standalone "i",
 * and close the sentence with punctuation. Deterministic and side-effect free.
 */
export function polishTranscript(raw: string): string {
  let text = raw.replace(/\s+/g, " ").trim();
  if (!text) return "";

  // Dictation lowercases these reliably, in any position.
  text = text
    .replace(/\bi'(m|ll|ve|d)\b/gi, (_m, suffix: string) => `I'${suffix.toLowerCase()}`)
    .replace(/\bi\b/g, "I")
    .replace(/\bok\b/gi, "OK");

  // No space before punctuation, and one after it when a word follows —
  // guarding on a letter keeps decimals (3.5) and times (10:30) intact.
  text = text
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([,.!?;:])(?=[A-Za-z])/g, "$1 ");

  // Capitalise the first letter, and the first letter after a sentence break
  // (dictation starts a new result after every pause).
  text = text
    .replace(/^([a-z])/, (m: string) => m.toUpperCase())
    .replace(/([.!?]\s+)([a-z])/g, (_all, lead: string, char: string) =>
      `${lead}${char.toUpperCase()}`,
    );

  if (!/[.!?…:,]$/.test(text)) text += ".";
  return text;
}

/* ------------------------------------------------------------------- hook */

export type DictationStatus = "idle" | "listening" | "recovering" | "error";

export interface DictationController {
  /** Whether this browser can dictate at all (Chrome, Edge, Safari). */
  supported: boolean;
  /** True while listening or recovering */
  listening: boolean;
  /** Granular status of speech recognition */
  status: DictationStatus;
  /** Non-blocking error/status description */
  errorMessage: string | null;
  /** Words recognised but not yet committed to the page. */
  interim: string;
  toggle: () => void;
  stop: () => void;
  retry: () => void;
}

const MAX_AUTO_RETRIES = 3;

/**
 * Microphone dictation with connection resilience, auto-recovery, and voice keyboard commands.
 *
 * `onFinal` receives each polished chunk of finished speech.
 * `onCommand` receives recognized keyboard commands.
 */
export function useDictation(
  onFinal: (text: string) => void,
  onCommand?: (command: VoiceCommand) => void,
): DictationController {
  const supported = useMemo(() => getRecognitionCtor() !== null, []);
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [interim, setInterim] = useState("");

  const recognitionRef = useRef<DictationRecognition | null>(null);
  /** True while the user wants the mic on — distinguishing intentional stops from connection drops */
  const wantedRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  const clearPendingTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const teardown = useCallback(
    (opts: { isUserStop?: boolean; keepError?: boolean } = {}) => {
      clearPendingTimer();
      if (opts.isUserStop) {
        wantedRef.current = false;
        retryCountRef.current = 0;
      }

      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      if (recognition) {
        recognition.onstart = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try {
          recognition.abort();
        } catch {
          // already stopped
        }
      }

      if (opts.isUserStop) {
        setStatus("idle");
        setErrorMessage(null);
      } else if (!opts.keepError) {
        setStatus("idle");
      }
      setInterim("");
    },
    [clearPendingTimer],
  );

  const startSession = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      toast.error("Voice dictation needs Chrome, Edge or Safari.");
      return;
    }

    clearPendingTimer();

    // Clean up existing session before creating new instance
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // noop
      }
      recognitionRef.current = null;
    }

    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setStatus("listening");
      setErrorMessage(null);
      setInterim("");
    };

    recognition.onresult = (event) => {
      let settled = "";
      let pending = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const said = result[0]?.transcript ?? "";
        if (result.isFinal) settled += ` ${said}`;
        else pending += ` ${said}`;
      }
      if (pending.trim()) setInterim(pending.trim());

      const trimmedSettled = settled.trim();
      if (trimmedSettled) {
        // Successful speech arrived — reset retry count and error state
        retryCountRef.current = 0;
        setErrorMessage(null);
        if (status !== "listening") {
          setStatus("listening");
        }

        const parsed = parseVoiceInput(trimmedSettled);

        // If there is normal speech before a command (e.g. "Today I went to college key Backspace")
        if (parsed.textBefore) {
          const polished = polishTranscript(parsed.textBefore);
          if (polished) {
            setInterim("");
            onFinalRef.current(polished);
          }
        }

        // If a command was recognized
        if (parsed.command && onCommandRef.current) {
          setInterim("");
          onCommandRef.current(parsed.command);
          return;
        }

        // If pure normal speech with no command
        if (!parsed.command && !parsed.textBefore) {
          const polished = polishTranscript(settled);
          if (polished) {
            setInterim("");
            onFinalRef.current(polished);
          }
        }
      }
    };

    recognition.onerror = (event) => {
      switch (event.error) {
        case "no-speech":
        case "aborted":
          // A natural pause or interruption — onend will seamlessly handle reconnection if wanted
          return;

        case "not-allowed":
        case "service-not-allowed":
          toast.error("Microphone access was blocked. Allow it in your browser and try again.");
          teardown({ isUserStop: true });
          return;

        case "audio-capture":
          toast.error("No microphone was found on this device.");
          teardown({ isUserStop: true });
          return;

        case "network":
          // Recoverable speech service connection loss
          if (wantedRef.current) {
            if (retryCountRef.current < MAX_AUTO_RETRIES) {
              retryCountRef.current += 1;
              setStatus("recovering");
              setErrorMessage(null);
              const delay = Math.min(1000 * retryCountRef.current, 3000);
              retryTimerRef.current = setTimeout(() => {
                if (wantedRef.current) {
                  startSession();
                }
              }, delay);
              return;
            }

            // Exceeded retries — enter error state with non-blocking retry button
            teardown({ keepError: true });
            setStatus("error");
            setErrorMessage("Voice typing temporarily lost its connection. Your existing text is safe.");
            return;
          }
          teardown({ isUserStop: true });
          return;

        default:
          if (wantedRef.current && retryCountRef.current < MAX_AUTO_RETRIES) {
            retryCountRef.current += 1;
            setStatus("recovering");
            const delay = Math.min(1000 * retryCountRef.current, 2500);
            retryTimerRef.current = setTimeout(() => {
              if (wantedRef.current) startSession();
            }, delay);
            return;
          }
          teardown({ keepError: true });
          setStatus("error");
          setErrorMessage("Voice typing stopped unexpectedly. Your existing text is safe.");
      }
    };

    // Chrome and Edge stop continuous recognition after brief silence or timeout.
    // Gracefully restart if user still logically wants dictation active.
    recognition.onend = () => {
      if (wantedRef.current && recognitionRef.current === recognition) {
        if (status === "listening" || status === "recovering") {
          retryTimerRef.current = setTimeout(() => {
            if (wantedRef.current) {
              try {
                recognition.start();
              } catch {
                // If reuse fails, create a fresh instance
                startSession();
              }
            }
          }, 150);
          return;
        }
      }

      if (!wantedRef.current) {
        setStatus("idle");
        setInterim("");
      }
    };

    recognitionRef.current = recognition;
    wantedRef.current = true;
    try {
      recognition.start();
    } catch {
      teardown({ keepError: true });
      setStatus("error");
      setErrorMessage("Voice typing could not start. Click retry to try again.");
    }
  }, [clearPendingTimer, status, teardown]);

  const toggle = useCallback(() => {
    if (status === "listening" || status === "recovering") {
      teardown({ isUserStop: true });
    } else if (status === "error") {
      retryCountRef.current = 0;
      setErrorMessage(null);
      startSession();
    } else {
      retryCountRef.current = 0;
      setErrorMessage(null);
      startSession();
    }
  }, [startSession, status, teardown]);

  const stop = useCallback(() => {
    teardown({ isUserStop: true });
  }, [teardown]);

  const retry = useCallback(() => {
    retryCountRef.current = 0;
    setErrorMessage(null);
    startSession();
  }, [startSession]);

  // Clean teardown on unmount
  useEffect(() => {
    return () => teardown({ isUserStop: true });
  }, [teardown]);

  return {
    supported,
    listening: status === "listening" || status === "recovering",
    status,
    errorMessage,
    interim,
    toggle,
    stop,
    retry,
  };
}

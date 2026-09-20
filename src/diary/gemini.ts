/**
 * AI provider abstraction. Gemini is an OPTIONAL, privacy-conscious layer:
 * - never invoked automatically
 * - only sends the content the user explicitly chose for that action
 * - API key is user-provided and stored locally on their device (BYOK)
 * - never exposes API keys or credentials
 * - store: false ensures diary content is private with no server-side conversation state
 *
 * Uses the modern @google/genai SDK with the current Interactions API.
 */
import { GoogleGenAI } from "@google/genai";
import type { DiaryEntry } from "./types";

export interface AIProvider {
  summarize(entries: DiaryEntry[], apiKey: string): Promise<string>;
  ask(entries: DiaryEntry[], question: string, apiKey: string): Promise<string>;
  suggestTitle(text: string, apiKey: string): Promise<string>;
  refineNote(text: string, apiKey: string): Promise<string>;
}

/** Primary Gemini model */
export const GEMINI_MODEL = "gemini-3.8-flash";

/** Maximum auto-retries for transient errors (429, 5xx, network) */
const MAX_TRANSIENT_RETRIES = 2;

interface ParsedGeminiError {
  status: number | null;
  message: string;
  isTransient: boolean;
  isKeyInvalid: boolean;
}

/**
 * Extracts structured status, message, and transient classification from Google errors.
 * Does NOT interpret every HTTP 400 as an invalid API key.
 */
export function parseGoogleError(err: unknown): ParsedGeminiError {
  let status: number | null = null;
  let rawMessage = "";
  if (err instanceof Error) {
    rawMessage = err.message;
  } else if (typeof err === "string") {
    rawMessage = err;
  } else if (err && typeof err === "object" && typeof (err as any).message === "string") {
    rawMessage = (err as any).message;
  } else {
    rawMessage = String(err || "");
  }
  let isKeyInvalid = false;

  if (err && typeof err === "object") {
    const obj = err as Record<string, any>;
    if (typeof obj.status === "number") status = obj.status;
    else if (typeof obj.statusCode === "number") status = obj.statusCode;
    else if (typeof obj.status === "string" && /^\d+$/.test(obj.status)) {
      status = parseInt(obj.status, 10);
    }

    // Inspect err.body (stringified or object payload from Google API)
    let bodyObj: any = null;
    if (typeof obj.body === "string") {
      try {
        bodyObj = JSON.parse(obj.body);
      } catch {
        // non-json body
      }
    } else if (obj.body && typeof obj.body === "object") {
      bodyObj = obj.body;
    }

    if (bodyObj) {
      const root = Array.isArray(bodyObj) ? bodyObj[0] : bodyObj;
      if (root?.error) {
        if (typeof root.error.code === "number" && !status) {
          status = root.error.code;
        } else if (typeof root.error.code === "string" && !status) {
          if (root.error.code === "too_many_requests") {
            status = 429;
          }
        }
        if (typeof root.error.message === "string" && root.error.message.trim()) {
          rawMessage = root.error.message.trim();
        }
        if (Array.isArray(root.error.details)) {
          for (const d of root.error.details) {
            if (d?.reason === "API_KEY_INVALID" || d?.message?.includes("API key not valid")) {
              isKeyInvalid = true;
            }
          }
        }
      }
    }
  }

  // Network / fetch / offline errors
  const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
  const isNetwork =
    isOffline ||
    /fetch failed|failed to fetch|network error|ECONNRESET|ENOTFOUND|ETIMEDOUT/i.test(rawMessage);

  if (isNetwork) {
    return {
      status: null,
      message: isOffline
        ? "Gemini is unavailable while offline. Please check your internet connection."
        : `Network connection to Gemini failed (${rawMessage}). Please check your connection.`,
      isTransient: true,
      isKeyInvalid: false,
    };
  }

  // Check key invalidity signals
  if (
    isKeyInvalid ||
    status === 401 ||
    /API key not valid|API_KEY_INVALID|invalid api key/i.test(rawMessage)
  ) {
    return {
      status: status || 401,
      message: "Your Gemini API key was rejected as invalid. Check your API key in Settings.",
      isTransient: false,
      isKeyInvalid: true,
    };
  }

  // 403 Forbidden
  if (status === 403) {
    return {
      status: 403,
      message: `Gemini access forbidden (403): ${rawMessage}. Check permissions in Google AI Studio.`,
      isTransient: false,
      isKeyInvalid: false,
    };
  }

  // 404 Not Found
  if (status === 404 || /not_found|model .* not found/i.test(rawMessage)) {
    return {
      status: 404,
      message: `Gemini model or endpoint not found: ${rawMessage}`,
      isTransient: false,
      isKeyInvalid: false,
    };
  }

  // 400 Bad Request (not key-related)
  if (status === 400) {
    return {
      status: 400,
      message: `Gemini rejected the request (400): ${rawMessage}`,
      isTransient: false,
      isKeyInvalid: false,
    };
  }

  // 429 Rate limit / quota
  if (
    status === 429 ||
    /rate limit|quota exceeded|resource exhausted|too_many_requests/i.test(rawMessage)
  ) {
    const detail =
      rawMessage && !/^\s*\[object\s+Object\]\s*$/i.test(rawMessage)
        ? rawMessage
        : "Rate limit or quota reached. Please try again in a moment.";
    return {
      status: 429,
      message: `Gemini rate limit: ${detail}`,
      isTransient: true,
      isKeyInvalid: false,
    };
  }

  // 5xx Server errors
  if (status && status >= 500 && status < 600) {
    return {
      status,
      message: `Gemini service is temporarily unavailable (${status}): ${rawMessage}`,
      isTransient: true,
      isKeyInvalid: false,
    };
  }

  // General unknown error
  return {
    status,
    message: rawMessage || "An unknown error occurred while contacting Gemini.",
    isTransient: false,
    isKeyInvalid: false,
  };
}

/**
 * Executes a Gemini request using ONLY the current @google/genai Interactions API.
 * Uses model gemini-3.8-flash, store: false, system_instruction, and generation_config.
 * Retries only transient (429, 5xx, network) errors with bounded exponential backoff.
 * Permanent errors (400, 401, 403, 404) are never retried.
 */
async function callGemini(
  prompt: string,
  apiKey: string,
  opts: {
    systemInstruction?: string;
    temperature?: number;
  } = {},
): Promise<string> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    throw new Error("Add your Gemini API key in Settings to use AI helpers.");
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("Gemini is unavailable while offline. Your original note is unchanged.");
  }

  const ai = new GoogleGenAI({ apiKey: cleanKey });

  // Prepare interactions payload according to specification
  const payload: {
    model: string;
    input: string;
    store: boolean;
    system_instruction?: string;
    generation_config?: {
      temperature: number;
    };
  } = {
    model: GEMINI_MODEL,
    input: prompt,
    store: false,
  };

  if (opts.systemInstruction) {
    payload.system_instruction = opts.systemInstruction;
  }

  if (opts.temperature !== undefined) {
    payload.generation_config = {
      temperature: opts.temperature,
    };
  }

  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const interaction = await (ai.interactions.create as (params: unknown) => Promise<any>)(payload);

      const outputText =
        typeof interaction?.output_text === "string"
          ? interaction.output_text
          : Array.isArray(interaction?.outputs)
            ? interaction.outputs
                .map((o: any) => (typeof o?.text === "string" ? o.text : ""))
                .join("")
            : "";

      if (outputText && outputText.trim().length > 0) {
        return outputText.trim();
      }

      throw new Error("Gemini returned an empty response. Your original note is unchanged.");
    } catch (err: unknown) {
      const parsed = parseGoogleError(err);

      // Only retry transient errors up to MAX_TRANSIENT_RETRIES
      if (parsed.isTransient && attempt <= MAX_TRANSIENT_RETRIES) {
        const backoffMs = attempt * 1000;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }

      // Permanent error or retries exhausted — throw descriptive message
      throw new Error(parsed.message);
    }
  }
}

function entryToPromptText(entries: DiaryEntry[], maxCharsPerEntry = 4000): string {
  return entries
    .map(
      (e) =>
        `Date: ${e.date}\nTitle: ${e.title}\n---\n${e.plainText.slice(0, maxCharsPerEntry)}`,
    )
    .join("\n\n=====\n\n");
}

export const geminiProvider: AIProvider = {
  async summarize(entries, apiKey) {
    if (!entries.length) return "There are no entries to summarize yet.";
    const prompt =
      "Summarize the following diary entries in a warm, concise paragraph (max 150 words). " +
      "Never invent events that are not in the text.\n\n" +
      entryToPromptText(entries);
    return callGemini(prompt, apiKey, {
      systemInstruction:
        "You are a gentle, thoughtful assistant helping someone reflect on their own private diary.",
      temperature: 0.6,
    });
  },

  async ask(entries, question, apiKey) {
    const context = entryToPromptText(entries);
    const prompt = `Question: ${question}\n\nDiary entries:\n${context}`;
    return callGemini(prompt, apiKey, {
      systemInstruction:
        "You are helping someone ask questions about their own private diary. " +
        "Answer only from the entries below. If the answer is not present, say so kindly. " +
        "Keep the tone warm and concise.",
      temperature: 0.5,
    });
  },

  async suggestTitle(text, apiKey) {
    const prompt =
      "Suggest one short, evocative diary entry title (max 6 words, no quotes) for this text:\n\n" +
      text.slice(0, 2000);
    return callGemini(prompt, apiKey, {
      systemInstruction:
        "You are a creative writing assistant. Return only the title text without quotation marks.",
      temperature: 0.8,
    });
  },

  async refineNote(text, apiKey) {
    const systemInstruction =
      "You are a diary-writing refinement assistant.\n" +
      "Improve the user's writing for grammar, spelling, punctuation, clarity, readability, and flow while preserving the exact meaning, facts, events, people, dates, and emotional intent.\n" +
      "Do not invent or add information.\n" +
      "Return only the refined diary text.";

    const prompt =
      "Please refine this diary note following the system instructions:\n\n" +
      text;

    return callGemini(prompt, apiKey, {
      systemInstruction,
      temperature: 0.4,
    });
  },
};

export function resolveProvider(): AIProvider {
  return geminiProvider;
}

/**
 * Shared unique-key rules.
 *
 * A unique key is a short, memorable handle a user creates in Settings and
 * can then use to sign in instead of typing their email and password.
 * Uniqueness is enforced server-side (see src/convex/uniqueKey.ts), backed by
 * a unique index on the users table — exactly like GitHub repository names.
 *
 * Constraints: exactly 6 characters with at least one uppercase letter, one
 * lowercase letter and one digit. Kept framework-free so the Convex functions
 * and the UI validate identically from this single module.
 */

export const UNIQUE_KEY_LENGTH = 6;

/** Exactly 6 chars: ≥1 uppercase, ≥1 lowercase, ≥1 digit. */
export function isValidUniqueKey(key: string): boolean {
  return (
    key.length === UNIQUE_KEY_LENGTH &&
    /[A-Z]/.test(key) &&
    /[a-z]/.test(key) &&
    /[0-9]/.test(key) &&
    !/[^A-Za-z0-9]/.test(key)
  );
}

/** Human-readable explanation of what is wrong (or null when it is valid). */
export function uniqueKeyIssue(key: string): string | null {
  if (key.length === 0) return "Enter your 6-character key.";
  if (key.length !== UNIQUE_KEY_LENGTH)
    return `The key must be exactly ${UNIQUE_KEY_LENGTH} characters.`;
  if (/[^A-Za-z0-9]/.test(key))
    return "Letters and numbers only — no spaces or symbols.";
  if (!/[A-Z]/.test(key)) return "Add at least one capital letter.";
  if (!/[a-z]/.test(key)) return "Add at least one lowercase letter.";
  if (!/[0-9]/.test(key)) return "Add at least one number.";
  return null;
}

/* ----------------------- post-sign-in prompt flag ----------------------- */
/**
 * After creating an account (email + password sign-up) the app pops a
 * "create your own unique key" card. The flag lives in sessionStorage so the
 * prompt appears once per sign-up, does not survive a browser restart, and
 * never needs a server round trip.
 */
const PROMPT_KEY = "my-diary:unique-key-prompt";

export function shouldPromptUniqueKey(): boolean {
  try {
    return sessionStorage.getItem(PROMPT_KEY) === "1";
  } catch {
    return false;
  }
}

export function markUniqueKeyPrompted(): void {
  try {
    sessionStorage.setItem(PROMPT_KEY, "1");
  } catch {
    // private mode — the prompt just won't reappear next load
  }
}

export function clearUniqueKeyPrompt(): void {
  try {
    sessionStorage.removeItem(PROMPT_KEY);
  } catch {
    // ignore
  }
}

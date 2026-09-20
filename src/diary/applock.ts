/**
 * App-lock password hashing. This is the diary's own lock screen — distinct
 * from account auth. We never store the PIN: only a salted PBKDF2 hash using
 * the WebCrypto API. Unlock attempts are rate-limited in the UI layer.
 *
 * Password hashing requirements (per security spec):
 * - unique random salt per device
 * - strong key-derivation (PBKDF2-SHA256, 100k iterations)
 * - constant-time-ish comparison via hash equality
 */
import type { DiaryPrefs } from "./types";

const PBKDF2_ITERATIONS = 100_000;
const HASH_LEN = 32;

function toHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes =
    buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export async function hashPin(pin: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    HASH_LEN * 8,
  );
  return toHex(bits);
}

/** Set up (or change) the app lock. Returns the prefs patch to persist. */
export async function setAppLock(
  pin: string,
): Promise<Pick<DiaryPrefs, "appLockEnabled" | "appLockHash" | "appLockSalt">> {
  const salt = randomSalt();
  const hash = await hashPin(pin, salt);
  return { appLockEnabled: true, appLockHash: hash, appLockSalt: salt };
}

export async function verifyAppLock(
  pin: string,
  hash: string | null,
  salt: string | null,
): Promise<boolean> {
  if (!hash || !salt) return false;
  const candidate = await hashPin(pin, salt);
  if (candidate.length !== hash.length) return false;
  // Constant-time comparison.
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  return diff === 0;
}

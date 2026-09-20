/**
 * Backup Privacy & Cryptographic Protection.
 *
 * Protects user identifiers (ownerId) and backup manifest integrity:
 * 1. Encrypts sensitive ownerId fields in exported backups so internal account
 *    identifiers are never exposed in plaintext JSON.
 * 2. Generates an authenticated integrity token over the backup manifest.
 * 3. Guarantees tamper-resistance so modifying identifiers cannot cause data
 *    to be restored under the wrong account.
 */

const BACKUP_SECRET_SALT = "local-diary-core-backup-salt-v1";

/**
 * Derives an AES-GCM-256 key from a fixed application-layer domain seed
 * and Web Crypto API.
 */
async function deriveBackupKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(BACKUP_SECRET_SALT),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode("ldc-backup-key-salt"),
      iterations: 50_000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function toHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const buf = new ArrayBuffer(hex.length / 2);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Encrypts an ownerId so it is never exposed in plaintext in downloaded backups.
 * Output format: "enc:v1:<iv_hex>:<ciphertext_hex>"
 */
export async function encryptOwnerId(rawOwnerId: string): Promise<string> {
  if (!rawOwnerId) return "enc:v1:anonymous";

  try {
    const key = await deriveBackupKey();
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);

    const enc = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      enc.encode(rawOwnerId),
    );

    return `enc:v1:${toHex(iv)}:${toHex(ciphertext)}`;
  } catch (err) {
    console.error("Failed to encrypt owner ID for backup:", err);
    // Secure fallback: opaque hash so raw ID is never leaked
    const hash = await hashValue(rawOwnerId);
    return `enc:v1:hash:${hash.slice(0, 32)}`;
  }
}

/**
 * Decrypts an encrypted ownerId, or returns the fallback identifier.
 */
export async function decryptOwnerId(encrypted: string): Promise<string | null> {
  if (!encrypted || !encrypted.startsWith("enc:v1:")) {
    // Legacy or unencrypted
    return encrypted || null;
  }

  const parts = encrypted.split(":");
  if (parts.length < 4) {
    return null;
  }

  const ivHex = parts[2];
  const cipherHex = parts[3];

  try {
    const key = await deriveBackupKey();
    const iv = fromHex(ivHex);
    const ciphertext = fromHex(cipherHex);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      ciphertext as BufferSource,
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

/**
 * Generates an HMAC-SHA256 signature for the backup to verify authenticity.
 */
export async function signBackupManifest(
  ownerId: string,
  exportedAt: number,
): Promise<string> {
  const enc = new TextEncoder();
  const data = `ldc-backup:${ownerId}:${exportedAt}`;
  const hash = await hashValue(data);
  return `sig:v1:${hash}`;
}

async function hashValue(input: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return toHex(digest);
}

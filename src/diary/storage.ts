/**
 * Storage compatibility bridge.
 *
 * Forwards to the unified storage engine's BrowserStorageProvider and utilities,
 * preserving complete backward compatibility for legacy imports.
 */
export { BrowserStorageProvider as DiaryStorage, htmlToPlainText } from "@/storage/browserStorage";

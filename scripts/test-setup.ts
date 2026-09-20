import "fake-indexeddb/auto";
import indexedDB, { IDBKeyRange } from "fake-indexeddb";

// @ts-expect-error global polyfill for testing
globalThis.indexedDB = indexedDB;
// @ts-expect-error global polyfill for testing
globalThis.IDBKeyRange = IDBKeyRange;

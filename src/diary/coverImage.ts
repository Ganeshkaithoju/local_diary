/**
 * Cover image handling — device photos become compact cover data URLs.
 *
 * Images are resized so a 100-book catalog stays well within IndexedDB
 * comfort (a few hundred KB per book at most), and re-encoded as JPEG for
 * predictable size across formats (HEIC output excluded by accept attribute).
 */

export const MAX_COVER_IMAGE_BYTES = 12 * 1024 * 1024; // 12 MB source cap
const MAX_DIMENSION = 1000; // long-edge px after resize (covers are ~3:4)
const JPEG_QUALITY = 0.82;

/**
 * Page images are full-bleed, so they keep more pixels than a cover — but
 * still well under a megabyte, keeping IndexedDB comfortable.
 */
const MAX_PAGE_DIMENSION = 1400;
const PAGE_JPEG_QUALITY = 0.72;

export function isSupportedImage(file: File): boolean {
  return /^image\/(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.type);
}

/**
 * Read an image file, downscale it so its longest edge is ≤ maxDimension, and
 * re-encode it as a compact JPEG data URL. Returns null when decoding fails.
 */
function resizeToDataUrl(
  file: File,
  maxDimension: number,
  quality: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    if (!isSupportedImage(file) || file.size > MAX_COVER_IMAGE_BYTES) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(null);
      img.onload = () => {
        const scale = Math.min(
          1,
          maxDimension / Math.max(img.width, img.height),
        );
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Read an image file, downscale it so its longest edge is ≤ MAX_DIMENSION,
 * and return a compact JPEG data URL. Returns null when decoding fails.
 */
export function resizeImageToDataUrl(file: File): Promise<string | null> {
  return resizeToDataUrl(file, MAX_DIMENSION, JPEG_QUALITY);
}

/**
 * Same pipeline for a page background: bigger, slightly more compressed, so a
 * full-page image stays crisp without bloating the local database.
 */
export function resizePageImageToDataUrl(file: File): Promise<string | null> {
  return resizeToDataUrl(file, MAX_PAGE_DIMENSION, PAGE_JPEG_QUALITY);
}

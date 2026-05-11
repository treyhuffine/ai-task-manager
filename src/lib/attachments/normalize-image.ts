/**
 * Server-side image normalization for the model API path.
 *
 * Anthropic and OpenAI accept JPEG / PNG / GIF / WebP only, with per-
 * image limits Anthropic doesn't enforce silently — they 4xx with a
 * vague error. Two transforms run before base64-encoding:
 *
 *   1. **HEIC/HEIF → JPEG.** iPhone photos default to HEIC; both
 *      providers reject the format. Conversion via `heic-convert`
 *      (libheif under the hood, no native build).
 *   2. **Downscale.** Anthropic caps each image at 5 MiB and 8000px
 *      on the longest edge. Sharp does the resize + re-encode in
 *      one pass; we target ~4 MiB to leave headroom after base64.
 *
 * The execution chat (Claude Code Read tool) doesn't use this — it
 * reads files from disk directly and Read handles HEIC + downscaling
 * client-side. This is purely for the orchestrator API path.
 */

import sharp from 'sharp';

/** Anthropic's per-image hard limits. We target slightly under so
 *  base64 expansion (~33% overhead) stays under the 5 MiB request budget. */
const MAX_PIXEL_EDGE = 8000;
const TARGET_BYTES = 4 * 1024 * 1024;

const HEIC_MIMES = new Set(['image/heic', 'image/heif']);

export interface NormalizedImage {
  /** Output mime — possibly different from input (HEIC → image/jpeg). */
  mime: string;
  /** Output bytes ready to base64-encode. */
  bytes: Buffer;
  /** True if any transform fired. Useful for debug/log only. */
  transformed: boolean;
}

/**
 * Normalize an image for inline-base64 forwarding to the model API.
 *
 * Returns the original bytes unchanged when no transform is needed
 * (already a supported format, under size + dimension limits).
 */
export async function normalizeImageForApi(
  bytes: Buffer,
  mime: string,
): Promise<NormalizedImage> {
  // HEIC/HEIF: convert to JPEG first, then downscale if needed.
  // We import dynamically because heic-convert pulls in a sizable
  // wasm bundle we shouldn't load on every cold path.
  let workingMime = mime;
  let workingBytes = bytes;

  if (HEIC_MIMES.has(mime)) {
    const { default: heicConvert } = await import('heic-convert');
    const out = await heicConvert({
      buffer: workingBytes as unknown as ArrayBufferLike,
      format: 'JPEG',
      quality: 0.9,
    });
    workingBytes = Buffer.from(out);
    workingMime = 'image/jpeg';
  }

  // Inspect dimensions + size. Sharp is cheap on metadata-only reads.
  const meta = await sharp(workingBytes).metadata();
  const longestEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
  const overSize = workingBytes.byteLength > TARGET_BYTES;
  const overDim = longestEdge > MAX_PIXEL_EDGE;

  if (!overSize && !overDim && workingMime === mime) {
    // No transforms needed and mime didn't change. Pass through.
    return { mime: workingMime, bytes: workingBytes, transformed: false };
  }

  if (overSize || overDim) {
    // Resize the longest edge to the cap, preserving aspect ratio.
    // Re-encode as JPEG for non-PNG inputs (smaller; PNG kept for
    // alpha-channel correctness). Quality 85 is a good size/quality
    // balance for chat screenshots.
    const targetEdge = overDim ? MAX_PIXEL_EDGE : longestEdge;
    let pipeline = sharp(workingBytes).resize({
      width: meta.width && meta.width >= meta.height! ? targetEdge : undefined,
      height: meta.height && meta.height > meta.width! ? targetEdge : undefined,
      fit: 'inside',
      withoutEnlargement: true,
    });

    if (workingMime === 'image/png') {
      pipeline = pipeline.png({ compressionLevel: 9 });
    } else {
      pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true });
      workingMime = 'image/jpeg';
    }

    workingBytes = await pipeline.toBuffer();

    // If still over budget after resize (rare — usually means an
    // 8k×8k photo), drop quality progressively.
    let quality = 80;
    while (workingBytes.byteLength > TARGET_BYTES && quality >= 50 && workingMime === 'image/jpeg') {
      workingBytes = await sharp(workingBytes).jpeg({ quality, mozjpeg: true }).toBuffer();
      quality -= 10;
    }
  }

  return { mime: workingMime, bytes: workingBytes, transformed: true };
}

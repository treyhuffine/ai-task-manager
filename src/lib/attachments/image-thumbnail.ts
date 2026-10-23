import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { getWorkDir } from '@/lib/config/paths';
import { processState } from '@/lib/process-state';
import { heicToJpeg, isHeicFile } from './heic';

export const IMAGE_THUMBNAIL_WIDTH = 480;
export const IMAGE_THUMBNAIL_HEIGHT = 320;

/** File stamps keep retaken screenshots fresh, without hashing their bytes
 * on every request. Authorization must happen before calling this helper. */
export async function imageVersion(file: string, thumbnail: boolean): Promise<string> {
  const stat = await fs.stat(file);
  return createHash('sha256').update(`${file}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${thumbnail ? 'thumb-v1' : 'original'}`).digest('hex');
}

/** Small, reusable WebP previews. Sharp runs the resize off the JS thread.
 * The disposable cache is file-backed, and concurrent requests share work. */
export async function imageThumbnail(file: string, version: string): Promise<Buffer> {
  const cache = path.join(getWorkDir(), 'preview', 'image-thumbnails');
  const cached = path.join(cache, `${version}.webp`);
  try { return await fs.readFile(cached); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const pending = processState('image-thumbnail.pending', () => new Map<string, Promise<Buffer>>());
  const existing = pending.get(cached);
  if (existing) return existing;
  const work = (async () => {
    // sharp can't decode HEIC: libheif does, into a JPEG with the photo's colors.
    const source = await isHeicFile(file) ? await heicToJpeg(await fs.readFile(file)) : file;
    const bytes = await sharp(source, { limitInputPixels: 40_000_000, animated: false })
      .rotate().resize(IMAGE_THUMBNAIL_WIDTH, IMAGE_THUMBNAIL_HEIGHT, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 }).toBuffer();
    await fs.mkdir(cache, { recursive: true });
    await fs.writeFile(cached, bytes);
    return bytes;
  })();
  pending.set(cached, work);
  try { return await work; } finally { pending.delete(cached); }
}

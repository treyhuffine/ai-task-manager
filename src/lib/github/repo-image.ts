/**
 * The bytes of an image in a GitHub repository, fetched by the home with the
 * user's GitHub credential and kept in a disposable cache, so a private
 * repository's screenshot shows in a reply the way a local one does.
 *
 * The credential goes to `raw.githubusercontent.com` and nowhere else: the
 * address is built from the parsed owner, repo and path, never taken from
 * the agent's text, and a redirect is not followed. Only an image under the
 * reply-image size cap is kept. A commit-addressed file never changes, so
 * its copy is final. A branch can move, so its copy is checked against
 * GitHub's ETag once a minute. When GitHub cannot be reached, the last copy
 * still shows.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { getWorkDir } from '@/lib/config/paths';
import { normalizeMime, resolveMime } from '@/lib/attachments/mime';
import { processState } from '@/lib/process-state';
import type { ReplyFile } from '@/lib/sessions/reply-files';
import { GITHUB_RAW_HOST, type GithubImageSource } from './image-urls';

/** How long a branch-addressed copy is reused before GitHub is asked whether it changed. */
export const GITHUB_IMAGE_REVALIDATE_MS = 60_000;
const FETCH_TIMEOUT_MS = 15_000;

export interface GithubImageOptions {
  /** Credentials to try in order. None means one unauthenticated request, which public repositories answer. */
  tokens: readonly string[];
  maxBytes: number;
  cacheDir?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

interface CacheMeta {
  mime: string;
  etag: string | null;
  fetchedAt: number;
  size: number;
}

export function githubImageCacheDir(): string {
  return path.join(getWorkDir(), 'preview', 'github-images');
}

export function fetchGithubImage(source: GithubImageSource, options: GithubImageOptions): Promise<ReplyFile> {
  const cacheDir = options.cacheDir ?? githubImageCacheDir();
  const file = path.join(cacheDir, createHash('sha256').update(source.fetchUrl).digest('hex'));
  // A card and its lightbox ask at the same time; one download serves both.
  const pending = processState('github-image.pending', () => new Map<string, Promise<ReplyFile>>());
  const existing = pending.get(file);
  if (existing) return existing;
  const work = fetchInto(source, file, options).finally(() => pending.delete(file));
  pending.set(file, work);
  return work;
}

async function fetchInto(source: GithubImageSource, file: string, options: GithubImageOptions): Promise<ReplyFile> {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const metaFile = `${file}.json`;
  const cached = await readMeta(metaFile, file);
  const fromCache = (meta: CacheMeta): ReplyFile => ({ ok: true, file, mime: meta.mime, size: meta.size });
  if (cached && (source.immutable || now() - cached.fetchedAt < GITHUB_IMAGE_REVALIDATE_MS)) return fromCache(cached);

  const target = new URL(source.fetchUrl);
  if (target.protocol !== 'https:' || target.host !== GITHUB_RAW_HOST) return { ok: false, status: 400, error: 'Not a GitHub image' };

  const attempts: (string | null)[] = options.tokens.length ? [...options.tokens] : [null];
  let refused: ReplyFile | null = null;
  for (const token of attempts) {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `token ${token}`;
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    let response: Response;
    try {
      response = await doFetch(target, { headers, redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch {
      if (cached) return fromCache(cached);
      return { ok: false, status: 502, error: 'Could not reach GitHub' };
    }
    if (response.status === 304 && cached) {
      await discard(response);
      const meta = { ...cached, fetchedAt: now() };
      await writeMeta(metaFile, meta);
      return fromCache(meta);
    }
    if (response.status === 200) {
      const mime = imageMime(response.headers.get('content-type'), source.name);
      if (!mime) {
        await discard(response);
        return { ok: false, status: 415, error: 'Only images are shown here' };
      }
      const declared = Number(response.headers.get('content-length') ?? 0);
      const bytes = declared > options.maxBytes ? null : await readCapped(response, options.maxBytes);
      if (!bytes) {
        await discard(response);
        return { ok: false, status: 413, error: 'Image is too large to show' };
      }
      await fs.mkdir(path.dirname(file), { recursive: true });
      const partial = `${file}.${randomUUID()}.part`;
      await fs.writeFile(partial, bytes);
      await fs.rename(partial, file);
      const meta: CacheMeta = { mime, etag: response.headers.get('etag'), fetchedAt: now(), size: bytes.byteLength };
      await writeMeta(metaFile, meta);
      return fromCache(meta);
    }
    await discard(response);
    if (response.status === 404 || response.status === 401 || response.status === 403) {
      // Another of the user's accounts may read this repository.
      refused = refusal(response.status, token !== null);
      continue;
    }
    if (cached) return fromCache(cached);
    if (response.status >= 300 && response.status < 400) return { ok: false, status: 502, error: 'GitHub sent this image elsewhere' };
    if (response.status === 429) return { ok: false, status: 503, error: 'GitHub rate limit reached' };
    return { ok: false, status: 502, error: `GitHub answered ${response.status}` };
  }
  return refused ?? { ok: false, status: 404, error: 'Not found on GitHub' };
}

function refusal(status: number, signedIn: boolean): ReplyFile {
  if (status === 404 && !signedIn) return { ok: false, status: 404, error: 'Sign in to GitHub with gh to show private images' };
  if (status === 404) return { ok: false, status: 404, error: 'Not on GitHub, or your account cannot read it' };
  return { ok: false, status: 403, error: 'GitHub refused the sign-in' };
}

/**
 * The image type GitHub reports, or the one the file name says when GitHub
 * only says "bytes". Anything else is not shown, whatever its name.
 */
function imageMime(contentType: string | null, name: string): string | null {
  const reported = normalizeMime(contentType);
  if (reported.startsWith('image/')) return reported;
  if (reported && reported !== 'application/octet-stream') return null;
  const byName = resolveMime(null, name);
  return byName.startsWith('image/') ? byName : null;
}

async function readCapped(response: Response, maxBytes: number): Promise<Buffer | null> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

async function readMeta(metaFile: string, file: string): Promise<CacheMeta | null> {
  try {
    const meta = JSON.parse(await fs.readFile(metaFile, 'utf8')) as Partial<CacheMeta>;
    if (typeof meta.mime !== 'string' || typeof meta.fetchedAt !== 'number' || typeof meta.size !== 'number') return null;
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size !== meta.size) return null;
    return { mime: meta.mime, etag: typeof meta.etag === 'string' ? meta.etag : null, fetchedAt: meta.fetchedAt, size: meta.size };
  } catch {
    return null;
  }
}

async function writeMeta(metaFile: string, meta: CacheMeta): Promise<void> {
  const partial = `${metaFile}.${randomUUID()}.part`;
  await fs.writeFile(partial, JSON.stringify(meta));
  await fs.rename(partial, metaFile);
}

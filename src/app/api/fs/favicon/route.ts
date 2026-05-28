import type { NextRequest } from 'next/server';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { saveAttachment } from '@/lib/attachments/save';
import { resolveMime } from '@/lib/attachments/mime';

/**
 * Best-effort favicon detection for a workspace folder.
 *
 * Walks an ordered list of conventional icon paths (Next.js App Router
 * `app/icon.*`, classic `public/favicon.ico`, root `favicon.ico`, …) and
 * returns the first found, copied into the attachments dir so the
 * workspace cover survives renames or deletions of the source folder.
 *
 * Same homedir confinement as the browse route — never reads outside the
 * user's home tree.
 */

/**
 * Ordered candidates. Apple touch icons and SVGs come first because they
 * tend to be the highest-fidelity representation of the project's mark.
 */
const CANDIDATES: ReadonlyArray<string> = [
  'public/apple-touch-icon.png',
  'public/apple-touch-icon-precomposed.png',
  'apple-touch-icon.png',
  'app/icon.svg',
  'app/icon.png',
  'public/icon.svg',
  'public/icon.png',
  'public/logo.svg',
  'public/logo.png',
  'src/app/icon.svg',
  'src/app/icon.png',
  'app/favicon.ico',
  'src/app/favicon.ico',
  'public/favicon.svg',
  'public/favicon.ico',
  'static/favicon.ico',
  'static/favicon.svg',
  'assets/icon.png',
  'assets/icon.svg',
  'favicon.ico',
];

const MAX_BYTES = 5 * 1024 * 1024; // 5 MiB — generous for SVGs and PNGs.

export async function POST(request: NextRequest) {
  try {
    const body: { path?: string } = await request.json().catch(() => ({}));
    const raw = (body.path ?? '').trim();
    if (!raw) {
      return Response.json({ error: 'path is required' }, { status: 400 });
    }

    const home = os.homedir();
    const expanded = raw.startsWith('~')
      ? path.join(home, raw.slice(1).replace(/^[/]/, ''))
      : path.resolve(raw);

    let resolved: string;
    try {
      resolved = await fs.realpath(expanded);
    } catch {
      return Response.json({ kind: 'none' });
    }

    const homeReal = await fs.realpath(home);
    if (resolved !== homeReal && !resolved.startsWith(homeReal + path.sep)) {
      return Response.json({ error: 'Path is outside home directory' }, { status: 403 });
    }

    for (const rel of CANDIDATES) {
      const candidate = path.join(resolved, rel);
      // Confirm the candidate still resolves inside the workspace — guards
      // against symlinks pointing somewhere unexpected.
      let real: string;
      try {
        real = await fs.realpath(candidate);
      } catch {
        continue;
      }
      if (!real.startsWith(resolved + path.sep) && real !== resolved) {
        continue;
      }

      let stat;
      try {
        stat = await fs.stat(real);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BYTES) {
        continue;
      }

      const buffer = await fs.readFile(real);
      const originalName = path.basename(real);
      const mime = resolveMime(null, originalName);
      const attachment = await saveAttachment({
        data: buffer,
        originalName,
        mimeType: mime,
      });
      return Response.json({ kind: 'found', attachment, source: rel });
    }

    return Response.json({ kind: 'none' });
  } catch (err) {
    console.error('[POST /api/fs/favicon]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

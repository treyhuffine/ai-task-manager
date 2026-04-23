/**
 * GET /api/attachments/[file_name]
 *
 * Streams an uploaded file from the attachments directory back to the
 * browser. Filenames are UUIDv7-based and content-stable, so responses are
 * immutable-cacheable.
 *
 * Auth: bearer token (middleware handles it). We serve to an authenticated
 * session only — attachments are user-private.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { getAttachmentsDir } from '@/lib/config/paths';
import { resolveMime } from '@/lib/attachments/mime';

/** Reject anything that isn't a bare `<uuid>.<ext>` filename. */
const SAFE_FILENAME_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ file_name: string }> },
) {
  try {
    const { file_name } = await params;

    if (!SAFE_FILENAME_RE.test(file_name)) {
      return Response.json({ error: 'Invalid filename' }, { status: 400 });
    }

    const dir = getAttachmentsDir();
    const absolute = path.join(dir, file_name);

    // Defense-in-depth: ensure the resolved path is still inside the
    // attachments dir after symlink / normalization resolution. The regex
    // above already blocks `/` and `..`, but belt-and-suspenders.
    if (path.relative(dir, absolute).startsWith('..')) {
      return Response.json({ error: 'Invalid filename' }, { status: 400 });
    }

    let bytes: Buffer;
    try {
      bytes = await fs.readFile(absolute);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return Response.json({ error: 'Not found' }, { status: 404 });
      }
      throw err;
    }

    const mime = resolveMime(null, file_name);

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(bytes.byteLength),
        // UUIDv7 filenames are content-stable; safe to cache aggressively.
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch (err) {
    console.error('[GET /api/attachments/[file_name]]', err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

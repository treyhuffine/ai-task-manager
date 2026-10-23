import { createReadStream, promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import { contentDisposition, UNTRUSTED_DOCUMENT_HEADERS } from '@/lib/attachments/delivery';

/** A single byte range. Multiple or malformed ranges are ignored, as HTTP permits. */
export function byteRange(header: string | null, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    const length = Number(match[2]);
    if (length === 0) return 'unsatisfiable';
    start = Math.max(0, size - length);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

/** Authorized bytes only. Inline callers supply a media MIME from the format allowlist. */
export async function fileBytes(request: Request, file: string, name: string, mime = 'application/octet-stream', download = true) {
  const stat = await fs.stat(/* turbopackIgnore: true */ file);
  if (!stat.isFile()) return Response.json({ error: 'This path is not a regular file.' }, { status: 400 });
  const etag = `"${stat.size.toString(36)}-${Math.trunc(stat.mtimeMs).toString(36)}-${stat.ino.toString(36)}"`;
  const headers = { ...UNTRUSTED_DOCUMENT_HEADERS, 'Content-Type': mime,
    'Content-Disposition': contentDisposition(download ? 'attachment' : 'inline', name.replace(/[\x00-\x1f\x7f]/g, '')),
    'Accept-Ranges': 'bytes', ETag: etag, 'Cache-Control': 'private, no-cache' };
  const requested = request.headers.get('range');
  const ifRange = request.headers.get('if-range');
  const range = requested && (!ifRange || ifRange === etag) ? byteRange(requested, stat.size) : null;
  if (!requested && request.headers.get('if-none-match')?.split(',').some(value => value.trim() === etag || value.trim() === '*')) return new Response(null, { status: 304, headers });
  if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${stat.size}` } });
  const { start, end } = range ?? { start: 0, end: stat.size - 1 };
  const length = stat.size === 0 ? 0 : end - start + 1;
  const body = request.method === 'HEAD' || length === 0 ? null : Readable.toWeb(createReadStream(/* turbopackIgnore: true */ file, { start, end, signal: request.signal })) as ReadableStream<Uint8Array>;
  return new Response(body, { status: range ? 206 : 200, headers: { ...headers, 'Content-Length': String(length), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}) } });
}

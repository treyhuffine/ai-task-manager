/**
 * How Ri serves a PDF, for an uploaded attachment (`/api/attachments/:file`)
 * and for a file in a chat's or agent's folder (`/api/sessions/:id/pdf`,
 * `/api/workspaces/:id/pdf`). Callers authorize the file first. The query
 * picks what comes back:
 *
 *   - nothing: the bytes, for the browser's own PDF viewer in the preview
 *     dialog. Byte ranges are honored, so a viewer can open a large PDF at
 *     its first page.
 *   - `download=1`: the same bytes as a download.
 *   - `thumbnail=1`: the first page as a WebP card thumbnail.
 *   - `page=N`: page N as a WebP, for a browser without a PDF viewer.
 *     `X-Pdf-Pages` on every image says how many pages there are.
 *
 * The browser's viewer runs the PDF in its own isolated context. Responses
 * keep it a PDF (`nosniff`) and in Ri's own frames, but carry no CSP
 * `sandbox`: some viewers refuse a sandboxed document, and an iframe can't
 * use the `sandbox` attribute either (Chrome then shows an error page).
 */

import { createReadStream, promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import { UNTRUSTED_DOCUMENT_HEADERS } from './delivery';
import { PDF_PAGE_WIDTH, PDF_THUMBNAIL_WIDTH, PdfRenderError, pdfVersion, renderPdfPage } from './pdf-render';

/** The extension this serves, checked on the requested and the real path. */
export const PDF_FILE = /\.pdf$/i;

/** Past this a file isn't a document anyone reads in a chat. */
export const PDF_MAX_BYTES = 2 * 1024 * 1024 * 1024;

const PDF_HEADERS = {
  'Content-Type': 'application/pdf',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "frame-ancestors 'self'",
} as const;

export function pdfError(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** `inline` or `attachment`, with the name in both header forms. */
function disposition(kind: 'inline' | 'attachment', name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function matches(header: string | null, etag: string): boolean {
  if (!header) return false;
  const opaque = (tag: string) => tag.trim().replace(/^W\//, '');
  return header.split(',').some(tag => tag.trim() === '*' || opaque(tag) === opaque(etag));
}

/** One `bytes=` range, or null for none, several or an unreadable one (send it all). */
export function byteRange(header: string | null, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    // A suffix: the last N bytes.
    const length = Number(match[2]);
    if (length === 0) return 'unsatisfiable';
    start = Math.max(0, size - length);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

/**
 * Serve `file`, a PDF this caller may read, as the request asks. `name` is
 * what a download is called.
 */
export async function pdfResponse(request: Request, file: string, name: string): Promise<Response> {
  let real: string;
  let stat: import('node:fs').Stats;
  try {
    real = await fs.realpath(file);
    stat = await fs.stat(real);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return pdfError(404, 'This PDF is no longer there.');
    throw err;
  }
  // The real path decides the type too, so a link named .pdf can't serve something else.
  if (!stat.isFile() || !PDF_FILE.test(real)) return pdfError(415, 'Only PDF files open here.');
  if (stat.size > PDF_MAX_BYTES) return pdfError(413, 'This PDF is too large to open here.');

  const query = new URL(request.url).searchParams;
  const page = query.get('thumbnail') === '1' ? 1 : query.has('page') ? Number(query.get('page')) : null;
  if (page !== null) return pageResponse(request, real, page, query.get('thumbnail') === '1' ? PDF_THUMBNAIL_WIDTH : PDF_PAGE_WIDTH);

  // Strong: the bytes go out unchanged, so a viewer may resume ranges on it.
  const etag = `"${stat.size.toString(36)}-${Math.trunc(stat.mtimeMs).toString(36)}-${stat.ino.toString(36)}"`;
  const headers: Record<string, string> = {
    ...PDF_HEADERS,
    'Content-Disposition': disposition(query.get('download') === '1' ? 'attachment' : 'inline', name),
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Cache-Control': 'private, no-cache',
  };
  const rangeHeader = request.headers.get('range');
  const ifRange = request.headers.get('if-range');
  const range = rangeHeader && (!ifRange || ifRange === etag) ? byteRange(rangeHeader, stat.size) : null;
  if (!rangeHeader && matches(request.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers });
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${stat.size}` } });
  }
  const { start, end } = range ?? { start: 0, end: stat.size - 1 };
  const length = stat.size === 0 ? 0 : end - start + 1;
  const body = length === 0 ? null : Readable.toWeb(createReadStream(real, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(body, {
    status: range ? 206 : 200,
    headers: { ...headers, 'Content-Length': String(length), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}) },
  });
}

async function pageResponse(request: Request, file: string, page: number, width: number): Promise<Response> {
  if (!Number.isInteger(page) || page < 1) return pdfError(400, 'Pages are numbered from 1.');
  const version = await pdfVersion(file);
  const etag = `"${version}-p${page}-w${width}"`;
  const cache = { ETag: etag, 'Cache-Control': 'private, no-cache' };
  if (matches(request.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers: cache });
  try {
    const rendered = await renderPdfPage(file, version, { page, width });
    return new Response(new Uint8Array(rendered.bytes), {
      headers: {
        ...UNTRUSTED_DOCUMENT_HEADERS,
        ...cache,
        'Content-Type': 'image/webp',
        'Content-Length': String(rendered.bytes.byteLength),
        'X-Pdf-Pages': String(rendered.pages),
      },
    });
  } catch (err) {
    if (!(err instanceof PdfRenderError)) throw err;
    // Never a 5xx: clients read gateway statuses as the Home being unreachable.
    return pdfError(err.code === 'no_page' ? 404 : 422, err.code === 'unreadable' ? 'This PDF could not be read.' : err.message);
  }
}

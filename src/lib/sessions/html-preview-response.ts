/**
 * An HTML artifact's preview, served as a document for the sandboxed iframe
 * that opens it (`src/components/chat-ui/artifacts/html-view.tsx`).
 *
 * Previews used to travel inside the file viewer's JSON, which the page then
 * parsed, rewrote and handed to `srcdoc`. That held several copies of the
 * markup on Ri's own main thread, so the viewer's 1 MiB cap stopped any real
 * gallery (one of screenshots runs 35 MiB of inline PNGs). Served as a
 * document, the browser's own parser streams it into the frame like any large
 * page, and Ri's page never holds the markup. What remains is a safety bound,
 * `HTML_PREVIEW_MAX_BYTES`, far past anything an agent writes as an artifact.
 *
 * The file goes out as written, with three additions: a doctype when it has
 * none (previews have always rendered in standards mode), Ri's head
 * (viewport, theme, variant control styles) right after the doctype, and the
 * variant control's script after the end. The isolation travels as headers:
 * `HTML_PREVIEW_RESPONSE_CSP` carries the iframe's sandbox and policy.
 *
 * Who may open which file is the caller's business (the `html` routes, and
 * `session-file-target.ts` for a chat). Errors render as a small page in the
 * frame, since the frame is where the person is looking.
 *
 * The same routes download the file (`download=1`): exactly as written, none
 * of Ri's parts added, under its own name. The checks are the preview's.
 */

import { createReadStream, promises as fs } from 'node:fs';
import { Readable, pipeline } from 'node:stream';
import { constants, createBrotliCompress, createGzip } from 'node:zlib';
import { negotiateEncoding } from '@/lib/api/compression';
import { MAX_PREVIEW_BYTES } from '@/lib/workspaces/read-file';
import { contentDisposition } from '@/lib/attachments/delivery';
import {
  HTML_PREVIEW_RESPONSE_CSP,
  HTML_PREVIEW_TAIL,
  htmlPreviewHead,
  htmlPreviewPartsVersion,
} from './html-preview-document';

/** Past this a file is a data dump, not an artifact. Not a rendering limit. */
export const HTML_PREVIEW_MAX_BYTES = 256 * 1024 * 1024;

export type HtmlPreviewTheme = 'light' | 'dark';

/** The extensions this preview renders, checked on the requested and the real path. */
export const HTML_FILE = /\.html?$/i;

/** First bytes read to place Ri's head and to tell text from binary. */
const HEAD_BYTES = 64 * 1024;
const BINARY_SNIFF_BYTES = 8 * 1024;
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const BROTLI_QUALITY = 4;

export function htmlPreviewTheme(value: string | null | undefined): HtmlPreviewTheme {
  return value === 'light' ? 'light' : 'dark';
}

export function formatPreviewBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  const mib = n / (1024 * 1024);
  return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MiB`;
}

export function htmlTooLargeMessage(size: number, limit = HTML_PREVIEW_MAX_BYTES): string {
  return `This HTML file is ${formatPreviewBytes(size)}, over the ${formatPreviewBytes(limit)} preview limit.`;
}

const NOT_READABLE = 'This file is not readable HTML.';

/**
 * Where Ri's head goes in a file's first bytes: after a UTF-8 byte order mark
 * (`start`, dropped, since the response declares UTF-8), and after a leading
 * doctype when there is one (`at`). Before the doctype the parser allows only
 * whitespace, comments and `<?…>` processing instructions, so a doctype later
 * than that is no doctype, and the preview supplies its own.
 */
export function htmlInsertion(head: Buffer): { start: number; at: number; doctype: boolean } {
  const start = head.subarray(0, 3).equals(UTF8_BOM) ? 3 : 0;
  // latin1 maps each byte to one character, so match offsets are byte offsets.
  const text = head.toString('latin1', start);
  const match = /^(?:[\t\n\f\r ]+|<!--[\s\S]*?-->|<\?[^>]*>)*<!doctype\b[^>]*>/i.exec(text);
  return match ? { start, at: start + match[0].length, doctype: true } : { start, at: start, doctype: false };
}

function looksBinary(sample: Buffer): boolean {
  return sample.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

/** The served document's opening: the file's head with Ri's head placed in it. */
function documentOpening(head: Buffer, theme: HtmlPreviewTheme): Buffer[] {
  const { start, at, doctype } = htmlInsertion(head);
  const ours = Buffer.from(htmlPreviewHead(theme));
  return doctype
    ? [head.subarray(start, at), ours, head.subarray(at)]
    : [Buffer.from('<!doctype html>'), ours, head.subarray(start)];
}

const TAIL = Buffer.from(HTML_PREVIEW_TAIL);

function baseHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': HTML_PREVIEW_RESPONSE_CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}

/** The file as written, saved under `name`. */
function downloadHeaders(name: string): Record<string, string> {
  return { ...baseHeaders(), 'Content-Disposition': contentDisposition('attachment', name), 'Cache-Control': 'private, no-store' };
}

/** A weak validator: the file's identity and version, and Ri's parts for the theme. */
function fileEtag(stat: { size: number; mtimeMs: number; ino: number }, theme: HtmlPreviewTheme): string {
  return `W/"${stat.size.toString(36)}-${Math.trunc(stat.mtimeMs).toString(36)}-${stat.ino.toString(36)}-${htmlPreviewPartsVersion(theme)}"`;
}

function matchesEtag(header: string | null, etag: string): boolean {
  if (!header) return false;
  const opaque = (tag: string) => tag.trim().replace(/^W\//, '');
  return header.split(',').some(tag => tag.trim() === '*' || opaque(tag) === opaque(etag));
}

/**
 * A streamed body, compressed when the browser accepts it. Compression runs
 * in zlib's thread pool, and cancelling the response (the dialog closing)
 * stops the stream and closes the file.
 */
function streamedResponse(request: Request, parts: AsyncIterable<Buffer>, status: number, headers: Record<string, string>): Response {
  const source = Readable.from(parts, { objectMode: false });
  const encoding = negotiateEncoding(request.headers.get('accept-encoding'));
  const out = !encoding ? source : pipeline(
    source,
    encoding === 'br'
      ? createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } })
      : createGzip(),
    () => { /* A cancelled or failed stream ends the response. Nothing to report. */ },
  );
  return new Response(Readable.toWeb(out) as ReadableStream<Uint8Array>, {
    status,
    headers: { ...headers, Vary: 'Accept-Encoding', ...(encoding ? { 'Content-Encoding': encoding } : {}) },
  });
}

/** An error, shown where the preview would be. */
export function htmlPreviewErrorResponse(status: number, message: string, theme: HtmlPreviewTheme): Response {
  const text = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{color-scheme:${theme}}html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:24px;text-align:center;font:14px/1.5 system-ui,sans-serif;color:light-dark(#71717a,#a1a1aa)}p{max-width:36em;margin:0}</style></head><body><p>${text}</p></body></html>`;
  return new Response(page, { status, headers: { ...baseHeaders(), 'Cache-Control': 'no-store' } });
}

/**
 * Serve an HTML file from this home's disk. The caller has already decided
 * the file may be shown. This checks it is still a readable HTML file within
 * the bound, by its real path so a link named `.html` can't serve another type.
 * With `download`, the file goes out as written, saved under that name.
 */
export async function htmlFilePreviewResponse(request: Request, file: string, theme: HtmlPreviewTheme, download?: string): Promise<Response> {
  let real: string;
  let stat: import('node:fs').Stats;
  try {
    real = await fs.realpath(file);
    stat = await fs.stat(real);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return htmlPreviewErrorResponse(404, 'This HTML file is no longer there.', theme);
    throw err;
  }
  if (stat.isDirectory()) return htmlPreviewErrorResponse(400, 'This is a folder, not an HTML file.', theme);
  if (!stat.isFile() || !HTML_FILE.test(real)) return htmlPreviewErrorResponse(415, 'Only HTML files open in this preview.', theme);
  if (stat.size > HTML_PREVIEW_MAX_BYTES) return htmlPreviewErrorResponse(413, htmlTooLargeMessage(stat.size), theme);

  const etag = fileEtag(stat, theme);
  const cache = { ETag: etag, 'Cache-Control': 'private, no-cache' };
  if (download === undefined && matchesEtag(request.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers: { ...baseHeaders(), ...cache, Vary: 'Accept-Encoding' } });
  }

  const head = Buffer.alloc(Math.min(HEAD_BYTES, stat.size));
  const handle = await fs.open(real, 'r');
  let headLength: number;
  try {
    headLength = (await handle.read(head, 0, head.length, 0)).bytesRead;
  } finally {
    await handle.close();
  }
  const opening = head.subarray(0, headLength);
  if (looksBinary(opening)) return htmlPreviewErrorResponse(415, NOT_READABLE, theme);

  if (download !== undefined) {
    async function* asWritten() {
      yield opening;
      if (headLength < stat.size) yield* createReadStream(real, { start: headLength }) as AsyncIterable<Buffer>;
    }
    return streamedResponse(request, asWritten(), 200, downloadHeaders(download));
  }

  async function* body() {
    yield* documentOpening(opening, theme);
    // Opened only once the browser reads past the head, and closed when the
    // stream ends or is cancelled.
    if (headLength < stat.size) yield* createReadStream(real, { start: headLength }) as AsyncIterable<Buffer>;
    yield TAIL;
  }
  return streamedResponse(request, body(), 200, { ...baseHeaders(), ...cache });
}

/**
 * Serve HTML another device read for us (a chat or agent that lives there).
 * Its worker answers with the file viewer's bounded read, so this has the
 * content already, or an answer saying why not. With `download`, as written.
 */
export function htmlAnswerPreviewResponse(
  request: Request,
  answer: { status: number; body: unknown },
  theme: HtmlPreviewTheme,
  where: string,
  download?: string,
): Response {
  const body = (answer.body ?? {}) as { content?: unknown; isBinary?: unknown; tooLarge?: unknown; size?: unknown; error?: unknown; message?: unknown };
  if (answer.status !== 200) {
    const message = typeof body.message === 'string' ? body.message : typeof body.error === 'string' ? body.error : `${where} could not read this file.`;
    return htmlPreviewErrorResponse(answer.status, message, theme);
  }
  if (body.tooLarge === true) {
    const size = typeof body.size === 'number' ? `${formatPreviewBytes(body.size)} ` : '';
    return htmlPreviewErrorResponse(413, `This HTML file is ${size}on ${where}. ${download === undefined ? 'Previews' : 'Downloads'} from another device stop at ${formatPreviewBytes(MAX_PREVIEW_BYTES)}.`, theme);
  }
  if (body.isBinary === true || typeof body.content !== 'string') return htmlPreviewErrorResponse(415, NOT_READABLE, theme);
  const content = Buffer.from(body.content, 'utf8');
  if (download !== undefined) {
    return streamedResponse(request, (async function* () { yield content; })(), 200, downloadHeaders(download));
  }
  async function* parts() {
    yield* documentOpening(content, theme);
    yield TAIL;
  }
  return streamedResponse(request, parts(), 200, { ...baseHeaders(), 'Cache-Control': 'no-store' });
}

/**
 * Page images for PDFs, rendered on the Home: a chat card's first-page
 * thumbnail, and the pages a browser without its own PDF viewer reads
 * (`src/components/chat-ui/artifacts/pdf-view.tsx`).
 *
 * pdf.js (`pdfjs-dist`) draws each page onto `@napi-rs/canvas`, in one worker
 * thread, so parsing a PDF never holds the server's thread (which every
 * request shares, see "Query cost" in AGENTS.md). The worker reads only the
 * byte ranges a page needs, so a large PDF's first page costs about what a
 * small one's does.
 *
 * PDFs are untrusted input. pdf.js runs with eval off and fonts drawn as
 * paths, the worker has a memory ceiling and each page a deadline, and a
 * worker that crashes or overruns is replaced. Renders are cached on disk,
 * keyed by the file's stamps, like image thumbnails (`image-thumbnail.ts`).
 * Callers authorize the file first.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as nodeModule from 'node:module';
import { Worker } from 'node:worker_threads';
import { getWorkDir } from '@/lib/config/paths';
import { processState } from '@/lib/process-state';
import { runtimeRepository } from '@/lib/releases/runtime-identity';

/** A chat card's thumbnail: 240 px wide, drawn at twice that for sharp screens. */
export const PDF_THUMBNAIL_WIDTH = 480;
/** A page read without the browser's viewer, sharp on a phone at 3x. */
export const PDF_PAGE_WIDTH = 1280;
const ALLOWED_WIDTHS = new Set([PDF_THUMBNAIL_WIDTH, PDF_PAGE_WIDTH]);
const PAGE_DEADLINE_MS = 20_000;
const IDLE_MS = 60_000;
const WORKER_MEMORY_MB = 512;
const RENDER_VERSION = 'pdf-v1';

export class PdfRenderError extends Error {
  constructor(
    /** `unreadable`: not a PDF pdf.js can open. `no_page`: past its last page.
     * `timeout`: too slow to draw. `unavailable`: the renderer couldn't run here. */
    public readonly code: 'unreadable' | 'no_page' | 'timeout' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'PdfRenderError';
  }
}

export interface PdfPage {
  /** WebP. */
  bytes: Buffer;
  pages: number;
}

/** A render's cache key: the file, its stamps and the renderer's version. */
export async function pdfVersion(file: string): Promise<string> {
  const stat = await fs.stat(file);
  return createHash('sha256').update(`${file}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${RENDER_VERSION}`).digest('hex');
}

/** Page `page` (from 1) of `file`, `width` pixels wide, as WebP. */
export async function renderPdfPage(file: string, version: string, { page, width }: { page: number; width: number }): Promise<PdfPage> {
  if (!Number.isInteger(page) || page < 1) throw new PdfRenderError('no_page', 'Pages are numbered from 1.');
  if (!ALLOWED_WIDTHS.has(width)) throw new Error(`Unsupported PDF render width ${width}`);
  const cache = path.join(getWorkDir(), 'preview', 'pdf-pages');
  const image = path.join(cache, `${version}-p${page}-w${width}.webp`);
  const count = path.join(cache, `${version}.pages`);
  try {
    const [bytes, pages] = await Promise.all([fs.readFile(image), fs.readFile(count, 'utf8')]);
    return { bytes, pages: Number(pages) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const pending = processState('pdf-render.pending', () => new Map<string, Promise<PdfPage>>());
  const existing = pending.get(image);
  if (existing) return existing;
  const work = (async () => {
    const rendered = await renderInWorker({ file, key: version, page, width });
    await fs.mkdir(cache, { recursive: true });
    await Promise.all([fs.writeFile(image, rendered.bytes), fs.writeFile(count, String(rendered.pages))]);
    return rendered;
  })();
  pending.set(image, work);
  try { return await work; } finally { pending.delete(image); }
}

// ─── The worker ───────────────────────────────────────────────

interface Job {
  id: number;
  request: { file: string; key: string; page: number; width: number };
  resolve: (page: PdfPage) => void;
  reject: (error: Error) => void;
}

interface Renderer {
  worker: Worker | null;
  queue: Job[];
  active: { job: Job; deadline: NodeJS.Timeout } | null;
  idle: NodeJS.Timeout | null;
  nextId: number;
}

type WorkerReply =
  | { id: number; bytes: Uint8Array; pages: number }
  | { id: number; error: 'unreadable' | 'no_page'; message: string; pages?: number };

/** One renderer per process: every copy of this module shares its worker. */
function renderer(): Renderer {
  return processState('pdf-render.worker', (): Renderer => ({ worker: null, queue: [], active: null, idle: null, nextId: 1 }));
}

function renderInWorker(request: Job['request']): Promise<PdfPage> {
  const state = renderer();
  return new Promise((resolve, reject) => {
    state.queue.push({ id: state.nextId++, request, resolve, reject });
    pump(state);
  });
}

/** One page at a time: a PDF can take a core while it draws. */
function pump(state: Renderer) {
  if (state.active || state.queue.length === 0) return;
  const job = state.queue.shift()!;
  if (state.idle) { clearTimeout(state.idle); state.idle = null; }
  let worker: Worker;
  try {
    worker = state.worker ?? startWorker(state);
  } catch (error) {
    job.reject(new PdfRenderError('unavailable', `PDF previews are unavailable here: ${(error as Error).message}`));
    pump(state);
    return;
  }
  const deadline = setTimeout(() => {
    // Too slow is treated like a crash: a fresh worker takes the next page.
    replaceWorker(state, new PdfRenderError('timeout', 'This PDF took too long to draw.'));
  }, PAGE_DEADLINE_MS);
  deadline.unref();
  state.active = { job, deadline };
  worker.postMessage({ id: job.id, ...job.request });
}

function settle(state: Renderer, reply: WorkerReply) {
  const active = state.active;
  if (!active || active.job.id !== reply.id) return;
  clearTimeout(active.deadline);
  state.active = null;
  if ('error' in reply) active.job.reject(new PdfRenderError(reply.error, reply.message));
  else active.job.resolve({ bytes: Buffer.from(reply.bytes.buffer, reply.bytes.byteOffset, reply.bytes.byteLength), pages: reply.pages });
  if (state.queue.length) pump(state);
  else {
    // An idle worker holds open documents and memory: let it go.
    state.idle = setTimeout(() => replaceWorker(state, null), IDLE_MS);
    state.idle.unref();
  }
}

/** Stop the worker, failing the page it was drawing, and go on with the queue. */
function replaceWorker(state: Renderer, failure: Error | null) {
  const { worker, active } = state;
  state.worker = null;
  state.active = null;
  if (state.idle) { clearTimeout(state.idle); state.idle = null; }
  if (active) {
    clearTimeout(active.deadline);
    active.job.reject(failure ?? new PdfRenderError('unavailable', 'The PDF renderer stopped.'));
  }
  void worker?.terminate();
  pump(state);
}

function startWorker(state: Renderer): Worker {
  // Resolved from the installation, not bundled: the worker loads pdf.js
  // itself, with its fonts, character maps and decoders beside it.
  // This base belongs to the installed runtime, not the build checkout.
  // Webpack replaces direct createRequire calls with its own resolver and
  // returns undefined for a dynamic base. Keep this factory native to Node.
  const createNodeRequire: typeof nodeModule.createRequire = Reflect.get(nodeModule, 'createRequire');
  const require = createNodeRequire(path.join(/* turbopackIgnore: true */ runtimeRepository(), 'package.json'));
  const pdfjs = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { pdfjs, root },
    resourceLimits: { maxOldGenerationSizeMb: WORKER_MEMORY_MB },
  });
  // Rendering never keeps the server alive on its own.
  worker.unref();
  worker.on('message', (reply: WorkerReply) => settle(state, reply));
  worker.on('error', (error) => {
    if (state.worker === worker) replaceWorker(state, new PdfRenderError('unreadable', `This PDF could not be drawn: ${error.message}`));
  });
  worker.on('exit', () => {
    if (state.worker === worker) replaceWorker(state, null);
  });
  state.worker = worker;
  return worker;
}

/**
 * The worker, as source: no file to locate at runtime, in a checkout or an
 * installed server alike. It keeps the last two documents open, so a reader
 * paging through one PDF doesn't reparse it for every page.
 */
const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');
const path = require('node:path');

const CHUNK = 65536;
const MAX_PIXELS = 12000000;
const dir = (name) => path.join(workerData.root, name) + path.sep;
let library;
const open = new Map();

async function documentFor(pdfjs, file, key) {
  const known = open.get(key);
  if (known) {
    open.delete(key);
    open.set(key, known);
    return known;
  }
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const first = Buffer.alloc(Math.min(size, CHUNK));
    await handle.read(first, 0, first.length, 0);
    const range = new pdfjs.PDFDataRangeTransport(size, new Uint8Array(first.buffer, first.byteOffset, first.length));
    range.requestDataRange = (begin, end) => {
      const chunk = Buffer.alloc(end - begin);
      handle.read(chunk, 0, chunk.length, begin).then(
        ({ bytesRead }) => range.onDataRange(begin, new Uint8Array(chunk.buffer, chunk.byteOffset, bytesRead)),
        () => range.onDataRange(begin, new Uint8Array(0)),
      );
    };
    const doc = await pdfjs.getDocument({
      range,
      length: size,
      rangeChunkSize: CHUNK,
      disableAutoFetch: true,
      disableStream: true,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      enableXfa: false,
      verbosity: 0,
      standardFontDataUrl: dir('standard_fonts'),
      cMapUrl: dir('cmaps'),
      cMapPacked: true,
      wasmUrl: dir('wasm'),
      iccUrl: dir('iccs'),
    }).promise;
    const entry = { doc, handle };
    open.set(key, entry);
    while (open.size > 2) {
      const [oldest, stale] = open.entries().next().value;
      open.delete(oldest);
      stale.doc.destroy().catch(() => {});
      stale.handle.close().catch(() => {});
    }
    return entry;
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

parentPort.on('message', async ({ id, file, key, page, width }) => {
  let pages;
  try {
    const pdfjs = await (library ??= import(pathToFileURL(workerData.pdfjs).href));
    const { doc } = await documentFor(pdfjs, file, key);
    pages = doc.numPages;
    if (page > pages) {
      parentPort.postMessage({ id, error: 'no_page', message: 'This PDF has ' + pages + (pages === 1 ? ' page.' : ' pages.'), pages });
      return;
    }
    const sheet = await doc.getPage(page);
    const natural = sheet.getViewport({ scale: 1 });
    let scale = width / natural.width;
    if (natural.width * natural.height * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (natural.width * natural.height));
    const viewport = sheet.getViewport({ scale });
    const { canvas, context } = doc.canvasFactory.create(Math.max(1, Math.round(viewport.width)), Math.max(1, Math.round(viewport.height)));
    // Paper is white: a transparent page would take the card's background.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await sheet.render({ canvas, canvasContext: context, viewport }).promise;
    const bytes = await canvas.encode('webp', 82);
    sheet.cleanup();
    parentPort.postMessage({ id, bytes, pages });
  } catch (error) {
    parentPort.postMessage({ id, error: 'unreadable', message: 'This PDF could not be read: ' + String((error && error.message) || error), pages });
  }
});
`;

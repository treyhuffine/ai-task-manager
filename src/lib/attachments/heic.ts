/**
 * HEIC photos, as JPEG.
 *
 * iPhones save photos as HEIC (HEIF with HEVC inside). Chrome, Firefox and
 * the desktop app can't show one, sharp's libvips can't decode one (its HEIF
 * support is AVIF only), and Claude's Read tool refuses one. So
 * `saveAttachment` stores a HEIC as a JPEG, and `imageThumbnail` draws one
 * it finds elsewhere (an older attachment, or a photo an agent showed by
 * path) the same way.
 *
 * libheif (`libheif-js`, WebAssembly) decodes in a worker thread, one photo
 * at a time, so a 12 MP photo's half second of decoding never holds the
 * server's thread (see "Query cost" in AGENTS.md). sharp encodes the JPEG,
 * off that thread too. libheif hands back pixels in the photo's own colors,
 * Display P3 on an iPhone, so the JPEG carries the photo's color profile.
 * Location, date and other EXIF fields don't carry over.
 *
 * Photos are untrusted input: the header is read with bounds checks, the
 * size is checked before any pixel is decoded, and each photo has a deadline.
 */

import fs from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import sharp from 'sharp';
import { processState } from '@/lib/process-state';
import { runtimeRequire } from '@/lib/releases/runtime-identity';

/** HEIF brands that mean HEVC coding. AVIF is HEIF too, and sharp reads it. */
const HEVC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs']);
/** An iPhone's 48 MP photos, with room to spare. Decoding one takes about 4 bytes a pixel, twice. */
const MAX_PIXELS = 64_000_000;
const DEADLINE_MS = 30_000;
const JPEG_QUALITY = 90;
/** nclx `colour_primaries` 12: SMPTE EG 432-1, Display P3. */
const P3_PRIMARIES = 12;

/** Whether these bytes start a HEIC photo, by its file type box rather than its name or label. */
export function isHeic(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || fourcc(bytes, 4) !== 'ftyp') return false;
  const end = Math.min(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0), bytes.length);
  if (HEVC_BRANDS.has(fourcc(bytes, 8))) return true;
  // Compatible brands follow the major brand and its minor version.
  for (let at = 16; at + 4 <= end; at += 4) if (HEVC_BRANDS.has(fourcc(bytes, at))) return true;
  return false;
}

/** `isHeic` for a file, reading only its first bytes. */
export async function isHeicFile(file: string): Promise<boolean> {
  const handle = await fs.open(file, 'r');
  try {
    const head = Buffer.alloc(256);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    return isHeic(head.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/** The photo as a JPEG at full size, upright and in its own colors. Rejects a
 * file libheif can't read, one larger than `maxPixels`, or one too slow to decode. */
export async function heicToJpeg(bytes: Uint8Array, { maxPixels = MAX_PIXELS }: { maxPixels?: number } = {}): Promise<Buffer> {
  const { width, height, pixels } = await decode(bytes, maxPixels);
  const jpeg = await sharp(pixels, { raw: { width, height, channels: 4 }, limitInputPixels: maxPixels })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
  const profile = await colorProfile(bytes);
  return profile ? withIccProfile(jpeg, profile) : jpeg;
}

// ─── Color ────────────────────────────────────────────────────

interface Box { type: string; start: number; end: number }

function fourcc(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
}

/** The ISO BMFF boxes between `start` and `end`. `start` of each is where its payload begins. */
function* boxes(bytes: Uint8Array, view: DataView, start: number, end: number): Generator<Box> {
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) return;
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) return;
    yield { type: fourcc(bytes, at + 4), start: at + header, end: at + size };
    at += size;
  }
}

/**
 * The ICC profile the primary image's pixels are in: its own (iPhones embed
 * Display P3), or Display P3 when its nclx color says so. Null means sRGB,
 * which an untagged JPEG already is, and stands for anything unreadable.
 */
async function colorProfile(bytes: Uint8Array): Promise<Uint8Array | null> {
  let p3 = false;
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const meta = [...boxes(bytes, view, 0, bytes.length)].find((box) => box.type === 'meta');
    if (!meta) return null;
    // `meta` is a full box: version and flags come first.
    const parts = [...boxes(bytes, view, meta.start + 4, meta.end)];
    const pitm = parts.find((box) => box.type === 'pitm');
    const iprp = parts.find((box) => box.type === 'iprp');
    if (!pitm || !iprp) return null;
    const primary = bytes[pitm.start] === 0 ? view.getUint16(pitm.start + 4) : view.getUint32(pitm.start + 4);
    const sections = [...boxes(bytes, view, iprp.start, iprp.end)];
    const ipco = sections.find((box) => box.type === 'ipco');
    if (!ipco) return null;
    const properties = [...boxes(bytes, view, ipco.start, ipco.end)];
    for (const ipma of sections.filter((box) => box.type === 'ipma')) {
      const version = bytes[ipma.start]!;
      const wideIndexes = (bytes[ipma.start + 3]! & 1) === 1;
      let at = ipma.start + 4;
      const entries = view.getUint32(at);
      at += 4;
      for (let entry = 0; entry < entries; entry++) {
        const item = version < 1 ? view.getUint16(at) : view.getUint32(at);
        at += version < 1 ? 2 : 4;
        const associations = bytes[at]!;
        at += 1;
        for (let n = 0; n < associations; n++) {
          const index = wideIndexes ? view.getUint16(at) & 0x7fff : bytes[at]! & 0x7f;
          at += wideIndexes ? 2 : 1;
          const property = item === primary && index > 0 ? properties[index - 1] : undefined;
          if (property?.type !== 'colr') continue;
          const kind = fourcc(bytes, property.start);
          if (kind === 'prof' || kind === 'rICC') return bytes.slice(property.start + 4, property.end);
          if (kind === 'nclx' && view.getUint16(property.start + 4) === P3_PRIMARIES) p3 = true;
        }
      }
    }
  } catch {
    // A header that runs past its box only costs the color tag.
    return null;
  }
  return p3 ? displayP3() : null;
}

/** libvips's own Display P3 profile, the one sharp's `withIccProfile('p3')` attaches. */
async function displayP3(): Promise<Uint8Array | null> {
  const sample = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000000' } })
    .withIccProfile('p3')
    .jpeg()
    .toBuffer();
  return (await sharp(sample).metadata()).icc ?? null;
}

/** ICC payload per APP2 segment: 65535, less the length field, "ICC_PROFILE\0", and the sequence and count bytes. */
const ICC_CHUNK = 65_535 - 2 - 12 - 2;

/**
 * Tag a JPEG with an ICC profile, as APP2 ICC_PROFILE segments right after
 * its JFIF header. The pixels are already in the profile's colors, so this
 * attaches it and converts nothing, which sharp's `withIccProfile` would.
 */
function withIccProfile(jpeg: Buffer, profile: Uint8Array): Buffer {
  const count = Math.ceil(profile.length / ICC_CHUNK);
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || count === 0 || count > 255) return jpeg;
  const segments: Uint8Array[] = [];
  for (let n = 0; n < count; n++) {
    const data = profile.subarray(n * ICC_CHUNK, (n + 1) * ICC_CHUNK);
    const header = Buffer.alloc(18);
    header.writeUInt16BE(0xffe2, 0);
    header.writeUInt16BE(2 + 14 + data.length, 2);
    header.write('ICC_PROFILE\0', 4, 'latin1');
    header[16] = n + 1;
    header[17] = count;
    segments.push(header, data);
  }
  // A JFIF APP0 segment must come straight after the start marker.
  const at = jpeg[2] === 0xff && jpeg[3] === 0xe0 ? 4 + jpeg.readUInt16BE(4) : 2;
  return Buffer.concat([jpeg.subarray(0, at), ...segments, jpeg.subarray(at)]);
}

// ─── The worker ───────────────────────────────────────────────

interface Decoded { width: number; height: number; pixels: Uint8Array }

type WorkerReply = Decoded | { error: string };

/** One photo at a time: a large one holds a few hundred MB while it decodes. */
function decode(bytes: Uint8Array, maxPixels: number): Promise<Decoded> {
  const lane = processState('heic.lane', () => ({ last: Promise.resolve() as Promise<void> }));
  const turn = lane.last.then(() => decodeInWorker(bytes, maxPixels));
  // The lane keeps only the order, never a photo's pixels.
  lane.last = turn.then(() => {}, () => {});
  return turn;
}

/** A worker per photo, stopped when it answers: HEIC uploads are occasional,
 * and nothing of libheif's memory outlives the photo. */
function decodeInWorker(bytes: Uint8Array, maxPixels: number): Promise<Decoded> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { libheif: runtimeRequire().resolve('libheif-js/wasm-bundle') } });
    } catch (error) {
      reject(new Error(`HEIC photos can't be decoded here: ${(error as Error).message}`));
      return;
    }
    let settled = false;
    const settle = (outcome: Decoded | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      void worker.terminate();
      if (outcome instanceof Error) reject(outcome);
      else resolve(outcome);
    };
    const deadline = setTimeout(() => settle(new Error('This photo took too long to decode.')), DEADLINE_MS);
    worker.on('message', (reply: WorkerReply) => settle('error' in reply ? new Error(reply.error) : reply));
    worker.on('error', (error) => settle(new Error(`The HEIC decoder failed: ${error.message}`)));
    worker.on('exit', () => settle(new Error('The HEIC decoder stopped.')));
    // A copy the worker owns: the caller keeps its bytes, and a pooled Buffer's memory is never handed over.
    const copy = new Uint8Array(bytes);
    worker.postMessage({ bytes: copy, maxPixels }, [copy.buffer]);
  });
}

/** The worker, as source: no file to locate at runtime, in a checkout or an
 * installed server alike (as `pdf-render.ts` does). */
const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { format } = require('node:util');

// libheif-js explains a failure on stdout. Keep it for the reply instead.
let said = '';
console.log = (...parts) => { said = format(...parts); };
const libheif = require(workerData.libheif);

parentPort.once('message', ({ bytes, maxPixels }) => {
  const fail = (message) => parentPort.postMessage({ error: said ? message + ' (' + said + ')' : message });
  try {
    const images = new libheif.HeifDecoder().decode(bytes);
    const image = images.find((candidate) => candidate.is_primary()) || images[0];
    if (!image) return fail('There is no photo in this HEIC file that libheif can read.');
    const width = image.get_width();
    const height = image.get_height();
    if (!(width > 0 && height > 0)) return fail('This photo has no size.');
    if (width * height > maxPixels) return fail('This photo is ' + width + ' by ' + height + ' pixels, more than Ri converts.');
    // libheif turns it upright (its irot and imir), and leaves its colors as they are.
    image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (shown) => {
      if (!shown) return fail('libheif could not decode this photo.');
      const pixels = new Uint8Array(shown.data.buffer, shown.data.byteOffset, shown.data.byteLength);
      parentPort.postMessage({ width, height, pixels }, [pixels.buffer]);
    });
  } catch (error) {
    fail('libheif could not read this photo: ' + String((error && error.message) || error));
  }
});
`;

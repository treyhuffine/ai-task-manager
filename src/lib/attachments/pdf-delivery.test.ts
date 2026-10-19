/**
 * How a PDF is served (`pdf-delivery.ts`): bytes with byte ranges for the
 * browser's viewer, downloads, page images from the real renderer, and the
 * refusals that keep it to PDFs.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { makePdf } from '@/test/fixtures/pdf';
import { byteRange, pdfResponse } from './pdf-delivery';
import { PDF_PAGE_WIDTH, PDF_THUMBNAIL_WIDTH } from './pdf-render';

let home: TestHome;
let dir: string;
let pdf: Buffer;
let file: string;
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-pdf-delivery-', openDb: false });
  dir = path.join(home.root, 'files');
  fs.mkdirSync(dir);
  pdf = makePdf(['Board update', 'Numbers', 'Next steps']);
  file = path.join(dir, 'board.pdf');
  fs.writeFileSync(file, pdf);
});
afterEach(async () => { await home.cleanup(); });

const get = (query = '', headers: Record<string, string> = {}, target = file, name = 'Board update.pdf') =>
  pdfResponse(new Request(`http://ri.local/api/sessions/s/pdf?path=x.pdf${query}`, { headers }), target, name);
const bytes = async (response: Response) => Buffer.from(await response.arrayBuffer());

describe('byteRange', () => {
  it('reads one range, a suffix, or an open end, and says when it is past the file', () => {
    expect(byteRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(byteRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(byteRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(byteRange('bytes=990-5000', 1000)).toEqual({ start: 990, end: 999 });
    expect(byteRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(byteRange('bytes=-0', 1000)).toBe('unsatisfiable');
    // Several ranges, or nonsense: send the whole file instead.
    expect(byteRange('bytes=0-1,5-6', 1000)).toBeNull();
    expect(byteRange('items=0-1', 1000)).toBeNull();
    expect(byteRange(null, 1000)).toBeNull();
  });
});

describe('pdfResponse', () => {
  it('serves the bytes inline for the browser viewer, kept a PDF in Ri frames', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect((await bytes(response)).equals(pdf)).toBe(true);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-length')).toBe(String(pdf.byteLength));
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'self'");
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(response.headers.get('content-disposition')).toBe(`inline; filename="Board update.pdf"; filename*=UTF-8''Board%20update.pdf`);
    expect(response.headers.get('etag')).toMatch(/^"[a-z0-9]+-[a-z0-9]+-[a-z0-9]+"$/);
  });

  it('honors a byte range, so a viewer can start at the first page', async () => {
    const part = await get('', { range: 'bytes=0-8' });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 0-8/${pdf.byteLength}`);
    expect(part.headers.get('content-length')).toBe('9');
    expect((await bytes(part)).toString('latin1')).toBe('%PDF-1.4\n');

    const tail = await get('', { range: 'bytes=-6' });
    expect(tail.status).toBe(206);
    expect((await bytes(tail)).toString('latin1')).toBe('%%EOF\n');

    const past = await get('', { range: `bytes=${pdf.byteLength}-` });
    expect(past.status).toBe(416);
    expect(past.headers.get('content-range')).toBe(`bytes */${pdf.byteLength}`);
  });

  it('revalidates, and resumes a range only on the same version of the file', async () => {
    const etag = (await get()).headers.get('etag')!;
    expect((await get('', { 'if-none-match': etag })).status).toBe(304);
    expect((await get('', { range: 'bytes=0-3', 'if-range': etag })).status).toBe(206);
    // A rewritten file sends itself whole rather than splice two versions.
    const stale = await get('', { range: 'bytes=0-3', 'if-range': '"older"' });
    expect(stale.status).toBe(200);
    expect((await bytes(stale)).byteLength).toBe(pdf.byteLength);
  });

  it('downloads under its name, any language included', async () => {
    const response = await get('&download=1', {}, file, 'Rapport été.pdf');
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="Rapport _t_.pdf"; filename*=UTF-8''Rapport%20%C3%A9t%C3%A9.pdf`);
    expect((await bytes(response)).equals(pdf)).toBe(true);
  });

  it('draws the first page as a thumbnail and any page for a browser without a viewer', async () => {
    const thumbnail = await get('&thumbnail=1');
    expect(thumbnail.status).toBe(200);
    expect(thumbnail.headers.get('content-type')).toBe('image/webp');
    expect(thumbnail.headers.get('x-pdf-pages')).toBe('3');
    expect(thumbnail.headers.get('content-security-policy')).toMatch(/^sandbox;/);
    expect((await sharp(await bytes(thumbnail)).metadata()).width).toBe(PDF_THUMBNAIL_WIDTH);

    const third = await get('&page=3');
    expect(third.status).toBe(200);
    expect(third.headers.get('x-pdf-pages')).toBe('3');
    expect((await sharp(await bytes(third)).metadata()).width).toBe(PDF_PAGE_WIDTH);
    const etag = third.headers.get('etag')!;
    expect((await get('&page=3', { 'if-none-match': etag })).status).toBe(304);

    expect(await (await get('&page=4')).json()).toEqual({ error: 'This PDF has 3 pages.' });
    expect((await get('&page=4')).status).toBe(404);
    expect((await get('&page=0')).status).toBe(400);
    expect((await get('&page=two')).status).toBe(400);
  }, 30_000);

  it('says so when a PDF cannot be drawn, and still serves its bytes for the viewer', async () => {
    const broken = path.join(dir, 'broken.pdf');
    fs.writeFileSync(broken, '%PDF-1.7\nnot really\n');
    const thumbnail = await get('&thumbnail=1', {}, broken);
    expect(thumbnail.status).toBe(422);
    expect(await thumbnail.json()).toEqual({ error: 'This PDF could not be read.' });
    expect((await get('', {}, broken)).status).toBe(200);
  }, 30_000);

  it('serves only PDF files, judged by where a link really leads', async () => {
    const secret = path.join(dir, 'secret.txt');
    fs.writeFileSync(secret, 'never shown');
    fs.symlinkSync(secret, path.join(dir, 'disguised.pdf'));
    fs.mkdirSync(path.join(dir, 'folder.pdf'));
    for (const [target, status] of [[path.join(dir, 'disguised.pdf'), 415], [path.join(dir, 'folder.pdf'), 415], [path.join(dir, 'gone.pdf'), 404]] as const) {
      const response = await get('', {}, target);
      expect(response.status).toBe(status);
      expect(await response.text()).not.toContain('never shown');
    }
  });
});

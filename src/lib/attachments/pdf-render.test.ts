/**
 * PDF pages rendered on the Home (`pdf-render.ts`): real pdf.js renders in
 * the real worker thread, cached by the file's stamps, with untrusted files
 * failing as errors rather than taking the server down.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { makePdf } from '@/test/fixtures/pdf';
import { PDF_PAGE_WIDTH, PDF_THUMBNAIL_WIDTH, PdfRenderError, pdfVersion, renderPdfPage } from './pdf-render';

let home: TestHome;
let dir: string;
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-pdf-render-', openDb: false });
  dir = path.join(home.root, 'files');
  fs.mkdirSync(dir);
});
afterEach(async () => { await home.cleanup(); });

const write = (name: string, bytes: Buffer) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  return file;
};
const render = async (file: string, page: number, width: number) => renderPdfPage(file, await pdfVersion(file), { page, width });

/** How much of the image is ink rather than white paper. */
async function inked(bytes: Buffer): Promise<number> {
  const { data } = await sharp(bytes).greyscale().raw().toBuffer({ resolveWithObject: true });
  let dark = 0;
  for (const value of data) if (value < 128) dark++;
  return dark / data.length;
}

describe('renderPdfPage', () => {
  it('draws a page as WebP at the requested width, standard fonts included', async () => {
    const file = write('report.pdf', makePdf(['Quarterly report', 'Appendix']));
    const thumbnail = await render(file, 1, PDF_THUMBNAIL_WIDTH);
    expect(thumbnail.pages).toBe(2);
    const meta = await sharp(thumbnail.bytes).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(PDF_THUMBNAIL_WIDTH);
    // US Letter keeps its shape: 612 x 792 points.
    expect(meta.height).toBe(Math.round(PDF_THUMBNAIL_WIDTH * 792 / 612));
    // The title is drawn: Helvetica came from pdf.js's bundled font data.
    expect(await inked(thumbnail.bytes)).toBeGreaterThan(0.004);

    const appendix = await render(file, 2, PDF_PAGE_WIDTH);
    expect(appendix.pages).toBe(2);
    expect((await sharp(appendix.bytes).metadata()).width).toBe(PDF_PAGE_WIDTH);
  }, 30_000);

  it('caches by the file stamps, and a rewritten file draws fresh', async () => {
    const file = write('notes.pdf', makePdf(['First draft']));
    const version = await pdfVersion(file);
    const first = await renderPdfPage(file, version, { page: 1, width: PDF_THUMBNAIL_WIDTH });
    const cache = path.join(home.workDir, 'preview', 'pdf-pages');
    expect(fs.readdirSync(cache).sort()).toEqual([`${version}-p1-w${PDF_THUMBNAIL_WIDTH}.webp`, `${version}.pages`]);
    // From disk, byte for byte, without the worker.
    expect((await renderPdfPage(file, version, { page: 1, width: PDF_THUMBNAIL_WIDTH })).bytes.equals(first.bytes)).toBe(true);

    await new Promise(resolve => setTimeout(resolve, 20));
    fs.writeFileSync(file, makePdf(['Second draft', 'With a second page']));
    const rewritten = await pdfVersion(file);
    expect(rewritten).not.toBe(version);
    expect((await renderPdfPage(file, rewritten, { page: 1, width: PDF_THUMBNAIL_WIDTH })).pages).toBe(2);
  }, 30_000);

  it('shares one render between requests for the same page', async () => {
    const file = write('shared.pdf', makePdf(['Shared']));
    const version = await pdfVersion(file);
    const [a, b] = await Promise.all([
      renderPdfPage(file, version, { page: 1, width: PDF_THUMBNAIL_WIDTH }),
      renderPdfPage(file, version, { page: 1, width: PDF_THUMBNAIL_WIDTH }),
    ]);
    expect(a).toBe(b);
  }, 30_000);

  it('says how many pages there are when asked for one past the end', async () => {
    const file = write('short.pdf', makePdf(['Only page']));
    await expect(render(file, 2, PDF_PAGE_WIDTH)).rejects.toMatchObject({ code: 'no_page', message: 'This PDF has 1 page.' });
    await expect(render(file, 0, PDF_PAGE_WIDTH)).rejects.toBeInstanceOf(PdfRenderError);
  }, 30_000);

  it('fails an unreadable file as an error, and the renderer keeps working', async () => {
    const broken = write('broken.pdf', Buffer.from('%PDF-1.7\nthis is not really a PDF\n'));
    await expect(render(broken, 1, PDF_THUMBNAIL_WIDTH)).rejects.toMatchObject({ code: 'unreadable' });
    const good = write('good.pdf', makePdf(['Still fine']));
    expect((await render(good, 1, PDF_THUMBNAIL_WIDTH)).pages).toBe(1);
  }, 30_000);

  it('only draws at the widths it serves', async () => {
    const file = write('wide.pdf', makePdf(['Wide']));
    await expect(render(file, 1, 4000)).rejects.toThrow('Unsupported PDF render width 4000');
  });
});

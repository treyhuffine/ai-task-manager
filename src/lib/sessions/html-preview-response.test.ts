/**
 * The HTML preview's served document (`html-preview-response.ts`): the file
 * byte for byte with Ri's head and tail placed around it, its isolation as
 * headers, and large files streamed rather than refused at the viewer's cap.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { brotliDecompress, gunzip } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HTML_PREVIEW_TAIL, htmlPreviewHead } from './html-preview-document';
import {
  HTML_PREVIEW_MAX_BYTES,
  htmlAnswerPreviewResponse,
  htmlFilePreviewResponse,
  htmlInsertion,
  htmlPreviewErrorResponse,
  htmlPreviewTheme,
} from './html-preview-response';
import { MAX_PREVIEW_BYTES } from '@/lib/workspaces/read-file';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-html-preview-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const request = (headers: Record<string, string> = {}) => new Request('http://ri.local/api/sessions/s/html', { headers });
const write = (name: string, content: string | Buffer) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
};
const text = async (response: Response) => Buffer.from(await response.arrayBuffer()).toString('utf8');

describe('htmlInsertion', () => {
  const at = (html: string) => {
    const place = htmlInsertion(Buffer.from(html));
    return { ...place, before: html.slice(0, place.at) };
  };

  it('places Ri after a leading doctype, past whitespace, comments and an XML prolog', () => {
    expect(at('<!DOCTYPE html><html>')).toMatchObject({ doctype: true, before: '<!DOCTYPE html>' });
    expect(at('\n  <!-- made by an agent --><?xml version="1.0"?>\n<!doctype html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "x.dtd"><html>'))
      .toMatchObject({ doctype: true, before: '\n  <!-- made by an agent --><?xml version="1.0"?>\n<!doctype html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "x.dtd">' });
  });

  it('supplies the doctype when the file has none, or has one after content', () => {
    expect(at('<html><body>Hi</body></html>')).toEqual({ start: 0, at: 0, doctype: false, before: '' });
    expect(at('<p>x</p><!doctype html>')).toMatchObject({ doctype: false, at: 0 });
    // An unterminated comment is not a way past it.
    expect(at('<!-- open <!doctype html>')).toMatchObject({ doctype: false });
  });

  it('drops a UTF-8 byte order mark, since the response declares UTF-8', () => {
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<!doctype html><p>é</p>')]);
    expect(htmlInsertion(bom)).toEqual({ start: 3, at: 3 + '<!doctype html>'.length, doctype: true });
  });
});

describe('htmlFilePreviewResponse', () => {
  it('serves the file whole, with Ri head after its doctype, the tail after its end, and isolation headers', async () => {
    const html = '<!doctype html><html lang="en"><head><title>Offers</title></head><body><h1>Annual</h1><script>window.ready=1</script></body></html>';
    const response = await htmlFilePreviewResponse(request(), write('offers.html', html), 'dark');
    expect(response.status).toBe(200);
    expect(await text(response)).toBe(`<!doctype html>${htmlPreviewHead('dark')}${html.slice('<!doctype html>'.length)}${HTML_PREVIEW_TAIL}`);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toMatch(/^sandbox allow-scripts; /);
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
    expect(response.headers.get('etag')).toMatch(/^W\/"/);
  });

  it('streams a file far past the file viewer cap, every byte intact across chunk boundaries', async () => {
    // A gallery's shape: inline base64 images, with multibyte text between them.
    const image = `<img src="data:image/png;base64,${Buffer.alloc(700 * 1024, 7).toString('base64')}">`;
    const html = `<!doctype html><html><body>${Array.from({ length: 6 }, (_, i) => `<section><h2>Désktop ${i} · 手机</h2>${image}</section>`).join('')}</body></html>`;
    expect(Buffer.byteLength(html)).toBeGreaterThan(5 * MAX_PREVIEW_BYTES);
    const response = await htmlFilePreviewResponse(request(), write('gallery.html', html), 'light');
    expect(response.status).toBe(200);
    const served = await text(response);
    expect(served).toBe(`<!doctype html>${htmlPreviewHead('light')}${html.slice('<!doctype html>'.length)}${HTML_PREVIEW_TAIL}`);
  });

  it('adds a doctype to a file without one, and drops a byte order mark', async () => {
    const plain = await htmlFilePreviewResponse(request(), write('plain.html', '<h1>Plain</h1>'), 'dark');
    expect(await text(plain)).toBe(`<!doctype html>${htmlPreviewHead('dark')}<h1>Plain</h1>${HTML_PREVIEW_TAIL}`);
    const bom = await htmlFilePreviewResponse(request(), write('bom.html', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<p>é</p>')])), 'dark');
    expect(await text(bom)).toBe(`<!doctype html>${htmlPreviewHead('dark')}<p>é</p>${HTML_PREVIEW_TAIL}`);
  });

  it('compresses the stream when the browser accepts it', async () => {
    const html = `<!doctype html><table>${'<tr><td>row</td><td>value</td></tr>'.repeat(20_000)}</table>`;
    const file = write('table.html', html);
    const expected = `<!doctype html>${htmlPreviewHead('dark')}${html.slice('<!doctype html>'.length)}${HTML_PREVIEW_TAIL}`;

    const br = await htmlFilePreviewResponse(request({ 'accept-encoding': 'gzip, deflate, br' }), file, 'dark');
    expect(br.headers.get('content-encoding')).toBe('br');
    expect(br.headers.get('vary')).toBe('Accept-Encoding');
    const brBytes = Buffer.from(await br.arrayBuffer());
    expect(brBytes.byteLength).toBeLessThan(Buffer.byteLength(html) / 10);
    expect((await promisify(brotliDecompress)(brBytes)).toString('utf8')).toBe(expected);

    const gzip = await htmlFilePreviewResponse(request({ 'accept-encoding': 'gzip' }), file, 'dark');
    expect(gzip.headers.get('content-encoding')).toBe('gzip');
    expect((await promisify(gunzip)(Buffer.from(await gzip.arrayBuffer()))).toString('utf8')).toBe(expected);
  });

  it('answers 304 to a matching validator, which changes with the file and the theme', async () => {
    const file = write('cached.html', '<p>v1</p>');
    const first = await htmlFilePreviewResponse(request(), file, 'dark');
    const etag = first.headers.get('etag')!;
    await first.body?.cancel();
    const again = await htmlFilePreviewResponse(request({ 'if-none-match': etag }), file, 'dark');
    expect(again.status).toBe(304);
    expect(again.body).toBeNull();
    expect(again.headers.get('etag')).toBe(etag);

    const otherTheme = await htmlFilePreviewResponse(request({ 'if-none-match': etag }), file, 'light');
    expect(otherTheme.status).toBe(200);
    await otherTheme.body?.cancel();

    fs.writeFileSync(file, '<p>version two</p>');
    const rewritten = await htmlFilePreviewResponse(request({ 'if-none-match': etag }), file, 'dark');
    expect(rewritten.status).toBe(200);
    expect(await text(rewritten)).toContain('version two');
  });

  it('closes the file when the viewer goes away mid-stream', async () => {
    const openFiles = () => fs.readdirSync('/dev/fd').length;
    const before = openFiles();
    const file = write('big.html', `<!doctype html>${'x'.repeat(8 * 1024 * 1024)}`);
    const response = await htmlFilePreviewResponse(request(), file, 'dark');
    const reader = response.body!.getReader();
    let received = 0;
    while (received < 512 * 1024) received += (await reader.read()).value?.byteLength ?? 0;
    expect(openFiles()).toBeGreaterThan(before);
    await reader.cancel();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(openFiles()).toBe(before);
  });

  it('refuses what is not a readable HTML file, as a page in the frame', async () => {
    fs.mkdirSync(path.join(dir, 'folder.html'));
    const binary = write('binary.html', Buffer.from([0x3c, 0x70, 0x3e, 0x00, 0x01, 0x02]));
    const secret = write('secret.txt', 'never shown');
    fs.symlinkSync(secret, path.join(dir, 'disguised.html'));

    const cases: Array<[string, number, string]> = [
      [path.join(dir, 'gone.html'), 404, 'This HTML file is no longer there.'],
      [path.join(dir, 'folder.html'), 400, 'This is a folder, not an HTML file.'],
      [binary, 415, 'This file is not readable HTML.'],
      [path.join(dir, 'disguised.html'), 415, 'Only HTML files open in this preview.'],
    ];
    for (const [file, status, message] of cases) {
      const response = await htmlFilePreviewResponse(request(), file, 'dark');
      expect(response.status).toBe(status);
      expect(response.headers.get('content-security-policy')).toMatch(/^sandbox allow-scripts; /);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const page = await text(response);
      expect(page).toContain(message);
      expect(page).not.toContain('never shown');
    }
  });

  it('keeps a safety bound far past any artifact, and says so plainly', async () => {
    const huge = path.join(dir, 'dump.html');
    fs.writeFileSync(huge, '');
    fs.truncateSync(huge, HTML_PREVIEW_MAX_BYTES + 1);
    const response = await htmlFilePreviewResponse(request(), huge, 'dark');
    expect(response.status).toBe(413);
    expect(await text(response)).toContain('This HTML file is 256.0 MiB, over the 256 MiB preview limit.');
  });
});

describe('downloading the file (download=1)', () => {
  it('saves the file exactly as written, none of Ri\'s parts, under its own name', async () => {
    const html = '\uFEFF<!doctype html><html><head><title>Plan</title></head><body><h1>Q3</h1></body></html>';
    const response = await htmlFilePreviewResponse(request({ 'if-none-match': '*' }), write('plan.html', html), 'dark', 'Q3 plan é.html');
    expect(response.status).toBe(200);
    expect(await text(response)).toBe(html);
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="Q3 plan _.html"; filename*=UTF-8''Q3%20plan%20%C3%A9.html`);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('etag')).toBeNull();
  });

  it('streams a large file whole', async () => {
    const big = `<!doctype html><pre>${'0123456789abcdef'.repeat(MAX_PREVIEW_BYTES / 8)}</pre>`;
    const response = await htmlFilePreviewResponse(request(), write('big.html', big), 'dark', 'big.html');
    expect(await text(response)).toBe(big);
  });

  it('refuses what the preview refuses', async () => {
    const secret = write('secret.txt', 'never shown');
    fs.symlinkSync(secret, path.join(dir, 'disguised.html'));
    const response = await htmlFilePreviewResponse(request(), path.join(dir, 'disguised.html'), 'dark', 'disguised.html');
    expect(response.status).toBe(415);
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(await text(response)).not.toContain('never shown');
  });

  it('saves what a connected device read, and names its cap as a download\'s', async () => {
    const saved = htmlAnswerPreviewResponse(request(), { status: 200, body: { content: '<!doctype html><p>From the laptop</p>', isBinary: false } }, 'dark', 'Laptop', 'laptop.html');
    expect(await text(saved)).toBe('<!doctype html><p>From the laptop</p>');
    expect(saved.headers.get('content-disposition')).toContain('attachment; filename="laptop.html"');
    const tooLarge = htmlAnswerPreviewResponse(request(), { status: 200, body: { content: null, tooLarge: true, size: 3 * 1024 * 1024 } }, 'dark', 'Laptop', 'big.html');
    expect(await text(tooLarge)).toContain('Downloads from another device stop at 1 MiB.');
  });
});

describe('htmlAnswerPreviewResponse', () => {
  it('serves HTML a connected device read, with the same head and tail', async () => {
    const response = htmlAnswerPreviewResponse(request(), { status: 200, body: { content: '<!doctype html><p>From the laptop</p>', isBinary: false } }, 'dark', 'Laptop');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await text(response)).toBe(`<!doctype html>${htmlPreviewHead('dark')}<p>From the laptop</p>${HTML_PREVIEW_TAIL}`);
  });

  it("explains the device's refusals and its read cap", async () => {
    const tooLarge = htmlAnswerPreviewResponse(request(), { status: 200, body: { content: null, tooLarge: true, size: 3 * 1024 * 1024 } }, 'dark', 'Laptop');
    expect(tooLarge.status).toBe(413);
    expect(await text(tooLarge)).toContain('This HTML file is 3 MiB on Laptop. Previews from another device stop at 1 MiB.');

    const away = htmlAnswerPreviewResponse(request(), { status: 409, body: { error: 'unavailable', message: 'Laptop is not connected right now.' } }, 'dark', 'Laptop');
    expect(away.status).toBe(409);
    expect(await text(away)).toContain('Laptop is not connected right now.');

    const binary = htmlAnswerPreviewResponse(request(), { status: 200, body: { content: null, isBinary: true } }, 'dark', 'Laptop');
    expect(binary.status).toBe(415);
  });
});

describe('htmlPreviewErrorResponse', () => {
  it('escapes the message and follows the theme', async () => {
    const response = htmlPreviewErrorResponse(403, 'Only <b>files</b> & folders', 'light');
    const page = await text(response);
    expect(page).toContain('Only &lt;b&gt;files&lt;/b&gt; &amp; folders');
    expect(page).toContain('color-scheme:light');
    expect(page).not.toContain('<script');
  });

  it('reads the theme from the URL, dark unless light is asked for', () => {
    expect(htmlPreviewTheme('light')).toBe('light');
    expect(htmlPreviewTheme('dark')).toBe('dark');
    expect(htmlPreviewTheme(null)).toBe('dark');
    expect(htmlPreviewTheme('<script>')).toBe('dark');
  });
});

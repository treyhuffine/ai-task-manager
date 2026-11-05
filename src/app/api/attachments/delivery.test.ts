import fs from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { ensureAttachmentsDir } from '@/lib/config/paths';
import path from 'node:path';
import { GET } from './[fileName]/route';
import { POST } from './route';

const files: string[] = [];
afterEach(() => { for (const file of files.splice(0)) fs.unlinkSync(file); });
it('isolates an uploaded active SVG while retaining image delivery', async () => {
  const fileName = 'sandbox-regression.svg';
  const file = path.join(ensureAttachmentsDir(), fileName);
  fs.writeFileSync(file, '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/api/user-state")</script></svg>');
  files.push(file);
  const response = await GET(new NextRequest(`http://localhost/api/attachments/${fileName}`), { params: Promise.resolve({ fileName }) });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/svg+xml');
  expect(response.headers.get('content-security-policy')).toMatch(/^sandbox;/);
  expect(response.headers.get('content-security-policy')).not.toContain('allow-scripts');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
});

it('takes a zip upload under either mime a browser sends, and serves it back as a zip', async () => {
  const bytes = Buffer.from('PK\u0005\u0006' + '\u0000'.repeat(18), 'latin1'); // an empty archive
  for (const type of ['application/zip', 'application/x-zip-compressed']) {
    const form = new FormData();
    form.append('file', new File([new Uint8Array(bytes)], 'backup.zip', { type }));
    const uploaded = await POST(new NextRequest('http://localhost/api/attachments', { method: 'POST', body: form }));
    expect(uploaded.status).toBe(201);
    const attachment = await uploaded.json();
    expect(attachment).toMatchObject({ originalName: 'backup.zip', mimeType: 'application/zip', size: bytes.byteLength });
    expect(attachment.fileName).toMatch(/^[A-Za-z0-9_-]+\.zip$/);
    files.push(path.join(ensureAttachmentsDir(), attachment.fileName));

    const served = await GET(new NextRequest(`http://localhost/api/attachments/${attachment.fileName}`), { params: Promise.resolve({ fileName: attachment.fileName }) });
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('application/zip');
    expect(Buffer.from(await served.arrayBuffer()).equals(bytes)).toBe(true);
  }
});

const upload = async (name: string, type: string, bytes = new Uint8Array([1, 2, 3])) => {
  const form = new FormData();
  form.append('file', new File([bytes], name, { type }));
  return POST(new NextRequest('http://localhost/api/attachments', { method: 'POST', body: form }));
};
const stored = async (name: string, type: string) => {
  const uploaded = await upload(name, type);
  expect(uploaded.status, name).toBe(201);
  const attachment = await uploaded.json();
  files.push(path.join(ensureAttachmentsDir(), attachment.fileName));
  return attachment;
};
const serve = (fileName: string, query = '') =>
  GET(new NextRequest(`http://localhost/api/attachments/${fileName}${query}`), { params: Promise.resolve({ fileName }) });

it('takes a file of any type, keeps its name, and serves it back only as a download', async () => {
  for (const [name, type, ext] of [
    ['scene.glb', 'model/gltf-binary', 'glb'], ['scene.glb', '', 'glb'], ['scene.blend', 'application/octet-stream', 'blend'],
    ['bracket.obj', 'model/obj', 'obj'], ['parts.7z', 'application/x-7z-compressed', '7z'], ['tool.exe', 'application/x-msdownload', 'exe'],
    ['no-extension', '', 'bin'],
  ]) {
    const attachment = await stored(name, type);
    expect(attachment).toMatchObject({ originalName: name, mimeType: 'application/octet-stream' });
    expect(attachment.fileName.endsWith(`.${ext}`), name).toBe(true);
    const served = await serve(attachment.fileName);
    expect(served.headers.get('content-type')).toBe('application/octet-stream');
    expect(served.headers.get('content-security-policy')).toMatch(/^sandbox;/);
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await served.arrayBuffer()).equals(Buffer.from([1, 2, 3]))).toBe(true);
    const named = await serve(attachment.fileName, `?download=1&name=${encodeURIComponent(name)}`);
    expect(named.headers.get('content-disposition')).toMatch(new RegExp(`^attachment; filename="${name}"`));
  }
});

it('never lets a label get an unknown type served inline', async () => {
  const unknown = await stored('page.xyz', 'text/html');
  expect(unknown.mimeType).toBe('application/octet-stream');
  expect((await serve(unknown.fileName)).headers.get('content-type')).toBe('application/octet-stream');
  // A name Ri knows is read as text, whatever the label says it is.
  const html = await stored('page.html', 'text/html');
  expect(html.mimeType).toBe('text/plain');
  expect((await serve(html.fileName)).headers.get('content-type')).toBe('text/plain');
});

it('keeps a label on the known list', async () => {
  expect(await stored('photo.png', 'image/png')).toMatchObject({ mimeType: 'image/png' });
  expect(await stored('data.json', 'application/json')).toMatchObject({ mimeType: 'text/plain' });
});

it('refuses a file over the cap, in words', async () => {
  const refused = await upload('scene.glb', 'model/gltf-binary', new Uint8Array(50 * 1024 * 1024 + 1));
  expect(refused.status).toBe(413);
  expect((await refused.json()).error).toBe('This file is larger than the 50 MiB limit.');
});

it('serves an uploaded PDF for the browser viewer, as a download under its name, and as a thumbnail', async () => {
  const { makePdf } = await import('@/test/fixtures/pdf');
  const pdf = makePdf(['Uploaded agenda']);
  const fileName = 'pdf-delivery-regression.pdf';
  const file = path.join(ensureAttachmentsDir(), fileName);
  fs.writeFileSync(file, pdf);
  files.push(file);
  const get = (query = '', headers: Record<string, string> = {}) =>
    GET(new NextRequest(`http://localhost/api/attachments/${fileName}${query}`, { headers }), { params: Promise.resolve({ fileName }) });

  const inline = await get('?name=Friday%20agenda.pdf');
  expect(inline.status).toBe(200);
  expect(inline.headers.get('content-type')).toBe('application/pdf');
  expect(inline.headers.get('accept-ranges')).toBe('bytes');
  expect(inline.headers.get('content-disposition')).toMatch(/^inline; filename="Friday agenda.pdf"/);
  expect(Buffer.from(await inline.arrayBuffer()).equals(pdf)).toBe(true);

  const range = await get('', { range: 'bytes=0-3' });
  expect(range.status).toBe(206);
  expect(Buffer.from(await range.arrayBuffer()).toString('latin1')).toBe('%PDF');

  const download = await get('?name=Friday%20agenda.pdf&download=1');
  expect(download.headers.get('content-disposition')).toMatch(/^attachment; filename="Friday agenda.pdf"/);
  // A name never becomes a path.
  expect((await get('?name=..%2F..%2Fetc%2Fpasswd')).headers.get('content-disposition')).toMatch(/^inline; filename="passwd"/);

  const thumbnail = await get('?thumbnail=1');
  expect(thumbnail.headers.get('content-type')).toBe('image/webp');
  expect(thumbnail.headers.get('x-pdf-pages')).toBe('1');
}, 30_000);

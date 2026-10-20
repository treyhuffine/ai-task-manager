import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { ensureAttachmentsDir } from '@/lib/config/paths';
import { GET } from './[fileName]/route';
import { POST } from './route';

const files: string[] = [];
afterEach(() => { for (const file of files.splice(0)) fs.rmSync(file, { force: true }); });
const upload = (name: string, type: string, purpose?: string) => {
  const form = new FormData();
  form.append('file', new File([new Uint8Array([1, 2, 3])], name, { type }));
  if (purpose) form.append('purpose', purpose);
  return POST(new NextRequest('http://localhost/api/attachments', { method: 'POST', body: form }));
};

it('takes a file of any type for a server\'s form, keeps its name, and serves it back only as a download', async () => {
  for (const [name, type] of [['scene.blend', 'application/octet-stream'], ['bracket.obj', 'model/obj'], ['parts.7z', 'application/x-7z-compressed']]) {
    // Anywhere else, these stay outside the allowlist.
    expect((await upload(name, type)).status, name).toBe(415);
    const uploaded = await upload(name, type, 'form-file');
    expect(uploaded.status, name).toBe(201);
    const attachment = await uploaded.json();
    expect(attachment).toMatchObject({ originalName: name, mimeType: 'application/octet-stream' });
    expect(attachment.fileName.endsWith(path.extname(name)), name).toBe(true);
    files.push(path.join(ensureAttachmentsDir(), attachment.fileName));
    const served = await GET(new NextRequest(`http://localhost/api/attachments/${attachment.fileName}`), { params: Promise.resolve({ fileName: attachment.fileName }) });
    expect(served.headers.get('content-type')).toBe('application/octet-stream');
    expect(served.headers.get('content-security-policy')).toMatch(/^sandbox;/);
  }
});

it('reads a form file\'s type from its name, so a label cannot make it something the page would render', async () => {
  const uploaded = await upload('page.html', 'text/html', 'form-file');
  expect(uploaded.status).toBe(201);
  const attachment = await uploaded.json();
  files.push(path.join(ensureAttachmentsDir(), attachment.fileName));
  expect(attachment.mimeType).toBe('text/plain');
});

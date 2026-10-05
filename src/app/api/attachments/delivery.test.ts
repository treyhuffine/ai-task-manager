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

it('still refuses a type that is not on the list', async () => {
  const form = new FormData();
  form.append('file', new File([new Uint8Array([1, 2, 3])], 'tool.exe', { type: 'application/x-msdownload' }));
  const refused = await POST(new NextRequest('http://localhost/api/attachments', { method: 'POST', body: form }));
  expect(refused.status).toBe(415);
});

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { ensureAttachmentsDir } from '@/lib/config/paths';
import { HEIC_PORTRAIT } from '@/test/fixtures/heic';
import { GET } from './[fileName]/route';
import { POST } from './route';

const files: string[] = [];
afterEach(() => { for (const file of files.splice(0)) fs.rmSync(file, { force: true }); });

const upload = async (type: string) => {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(HEIC_PORTRAIT)], 'IMG_4021.HEIC', { type }));
  const response = await POST(new NextRequest('http://localhost/api/attachments', { method: 'POST', body: form }));
  expect(response.status).toBe(201);
  const attachment = await response.json();
  files.push(path.join(ensureAttachmentsDir(), attachment.fileName));
  return attachment;
};
const serve = (fileName: string, query = '') =>
  GET(new NextRequest(`http://localhost/api/attachments/${fileName}${query}`), { params: Promise.resolve({ fileName }) });

it('takes an iPhone photo and serves it back as a JPEG any browser shows', async () => {
  // Safari labels it image/heic. Chrome on Windows and Linux sends no type at all.
  for (const type of ['image/heic', '']) {
    const attachment = await upload(type);
    expect(attachment, type).toMatchObject({ originalName: 'IMG_4021.jpg', mimeType: 'image/jpeg' });
    const served = await serve(attachment.fileName);
    expect(served.headers.get('content-type')).toBe('image/jpeg');
    expect(await sharp(Buffer.from(await served.arrayBuffer())).metadata()).toMatchObject({ format: 'jpeg', width: 48, height: 64 });
    const thumbnail = await serve(attachment.fileName, '?thumbnail=1');
    expect(thumbnail.headers.get('content-type')).toBe('image/webp');
  }
});

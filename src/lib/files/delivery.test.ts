import fs from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { previewFile } from './source';
import { readFilePreview } from './preview';
import { fileBytes } from './byte-delivery';
import { GET as media } from '@/app/api/sessions/[id]/media/route';
import { GET as download } from '@/app/api/sessions/[id]/download/route';
import { POST as upload } from '@/app/api/attachments/route';
import { GET as attachment } from '@/app/api/attachments/[fileName]/route';

let home: TestHome;
let folder: string;
let outside: string;
let sessionId: string;
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-file-preview-delivery-' });
  const identity = await import('@/lib/home/identity'); identity.resetHomeIdentityCache(); identity.ensureHomeIdentity();
  const q = await import('@/lib/db/queries');
  folder = path.join(home.root, 'folder'); outside = path.join(home.root, 'outside');
  await fs.mkdir(folder); await fs.mkdir(outside);
  const ws = q.createWorkspace({ name: 'Preview files', cwd: folder, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  sessionId = q.createChatSession({ workspaceId: ws.id, harness: 'claude', type: 'orchestration' }).id;
});
afterEach(async () => { (await import('@/lib/home/identity')).resetHomeIdentityCache(); await home.cleanup(); });

it('streams audio/video byte ranges, conditional reads and HEAD without a text preview cap', async () => {
  await fs.writeFile(path.join(folder, 'demo.mp4'), Buffer.from('0123456789'));
  const get = (headers = {}, method = 'GET') => media(new NextRequest('http://ri.local/?path=demo.mp4', { headers, method }), { params: Promise.resolve({ id: sessionId }) });
  const partial = await get({ range: 'bytes=2-5' });
  expect(partial.status).toBe(206); expect(await partial.text()).toBe('2345');
  expect(partial.headers.get('content-range')).toBe('bytes 2-5/10'); expect(partial.headers.get('content-type')).toBe('video/mp4');
  expect(await (await get({ range: 'bytes=-3' })).text()).toBe('789');
  expect((await get({ range: 'bytes=10-' })).status).toBe(416);
  const head = await get({}, 'HEAD'); expect(head.headers.get('content-length')).toBe('10'); expect(await head.text()).toBe('');
  expect((await get({ 'if-none-match': head.headers.get('etag')! })).status).toBe(304);
  expect((await get({ range: 'bytes=2-5', 'if-range': 'old-version' })).status).toBe(200);
});
it('only opens exact references shared in this chat, including unknown formats', async () => {
  const q = await import('@/lib/db/queries');
  const file = path.join(outside, 'result.bin'); await fs.writeFile(file, Buffer.from([0, 1, 2, 3]));
  const source = { kind: 'session' as const, sessionId, path: file };
  q.insertChatEvent({ sessionId, role: 'assistant', source: 'agent', content: `[Backup](${file}.bak) and https://example.com${file}` });
  await expect(previewFile(source)).rejects.toMatchObject({ status: 403 });
  q.insertChatEvent({ sessionId, role: 'assistant', source: 'agent', content: `[Result](${file})` });
  expect(await readFilePreview(source)).toMatchObject({ kind: 'file', size: 4 });
  const saved = await download(new NextRequest(`http://ri.local/?path=${encodeURIComponent(file)}`), { params: Promise.resolve({ id: sessionId }) });
  expect(saved.status).toBe(200); expect(Buffer.from(await saved.arrayBuffer())).toEqual(Buffer.from([0, 1, 2, 3]));
  expect(saved.headers.get('content-disposition')).toContain('attachment;');
  const other = q.createChatSession({ harness: 'claude', type: 'orchestration' });
  await expect(previewFile({ ...source, sessionId: other.id })).rejects.toMatchObject({ status: 403 });
});
it('rejects traversal, directories, missing files and non-media inline delivery', async () => {
  await fs.writeFile(path.join(folder, 'README'), 'Notes');
  for (const [file, status] of [['../outside/secret.txt', 400], ['missing.zip', 404], ['.', 400]] as const) await expect(previewFile({ kind: 'session', sessionId, path: file })).rejects.toMatchObject({ status });
  const response = await media(new NextRequest('http://ri.local/?path=README'), { params: Promise.resolve({ id: sessionId }) });
  expect(response.status).toBe(415);
  await expect(previewFile({ kind: 'attachment', fileName: '../secret.bin' })).rejects.toMatchObject({ status: 400 });
});
it('handles zero-byte files and suffix ranges safely', async () => {
  const file = path.join(folder, 'empty.bin'); await fs.writeFile(file, '');
  const response = await fileBytes(new Request('http://ri.local/'), file, 'empty.bin');
  expect(response.headers.get('content-length')).toBe('0'); expect(await response.text()).toBe('');
  expect((await fileBytes(new Request('http://ri.local/', { headers: { range: 'bytes=-1' } }), file, 'empty.bin')).status).toBe(416);
});

it('accepts video uploads and serves uploaded media with seeking and an original-name download', async () => {
  const bytes = Buffer.from('0123456789');
  const form = new FormData(); form.append('file', new File([new Uint8Array(bytes)], 'Screen recording.mp4', { type: 'video/mp4' }));
  const response = await upload(new NextRequest('http://ri.local/api/attachments', { method: 'POST', body: form }));
  expect(response.status).toBe(201);
  const record = await response.json();
  expect(record).toMatchObject({ mimeType: 'video/mp4', originalName: 'Screen recording.mp4' });
  expect(await readFilePreview({ kind: 'attachment', fileName: record.fileName })).toMatchObject({ kind: 'video', size: 10 });
  const range = await attachment(new NextRequest('http://ri.local/?media=video', { headers: { range: 'bytes=4-7' } }), { params: Promise.resolve({ fileName: record.fileName }) });
  expect(range.status).toBe(206); expect(range.headers.get('content-type')).toBe('video/mp4'); expect(await range.text()).toBe('4567');
  const saved = await attachment(new NextRequest('http://ri.local/?download=1&name=Screen%20recording.mp4'), { params: Promise.resolve({ fileName: record.fileName }) });
  expect(saved.headers.get('content-disposition')).toContain('filename="Screen recording.mp4"'); expect(await saved.text()).toBe('0123456789');
});

it('distinguishes audio and video WebM attachments using their recorded media type', async () => {
  const { saveAttachment } = await import('@/lib/attachments/save');
  const audio = await saveAttachment({ data: Buffer.from('webm'), originalName: 'memo.webm', mimeType: 'audio/webm' });
  const video = await saveAttachment({ data: Buffer.from('webm'), originalName: 'demo.webm', mimeType: 'video/webm' });
  expect(await readFilePreview({ kind: 'attachment', fileName: audio.fileName, media: 'audio' })).toMatchObject({ kind: 'audio' });
  expect(await readFilePreview({ kind: 'attachment', fileName: video.fileName, media: 'video' })).toMatchObject({ kind: 'video' });
  const result = await attachment(new NextRequest('http://ri.local/?media=video'), { params: Promise.resolve({ fileName: video.fileName }) });
  expect(result.headers.get('content-type')).toBe('video/webm');
  await result.arrayBuffer();
});

it('serves relative HTML and images from the agent main chat folder too', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  await fs.writeFile(path.join(folder, 'report.html'), '<h1>Agent report</h1>');
  await fs.writeFile(path.join(folder, 'shot.png'), png);
  const { GET: html } = await import('@/app/api/sessions/[id]/html/route');
  const htmlResponse = await html(new NextRequest('http://ri.local/?path=report.html'), { params: Promise.resolve({ id: sessionId }) });
  expect(htmlResponse.status).toBe(200);
  expect(await htmlResponse.text()).toContain('<h1>Agent report</h1>');
  const { GET: image } = await import('@/app/api/sessions/[id]/reply-image/route');
  const imageResponse = await image(new NextRequest('http://ri.local/?path=shot.png'), { params: Promise.resolve({ id: sessionId }) });
  expect(imageResponse.status).toBe(200);
  expect(Buffer.from(await imageResponse.arrayBuffer()).equals(png)).toBe(true);
});

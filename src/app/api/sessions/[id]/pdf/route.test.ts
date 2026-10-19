/**
 * `GET /api/sessions/:id/pdf`: a PDF from a chat, for the preview dialog,
 * a download and card thumbnails. It opens what the chat's file viewer opens
 * (`src/lib/sessions/session-file-target.ts`), PDFs only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { makePdf } from '@/test/fixtures/pdf';

let home: TestHome | undefined;
afterEach(async () => {
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home?.cleanup();
  home = undefined;
});

const REPORT = makePdf(['Member offers', 'All cases']);

async function setup() {
  home = await createTestHome({ prefix: 'ri-session-pdf-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  const q = await import('@/lib/db/queries');
  const folder = path.join(home.root, 'worktree');
  const outside = path.join(home.root, 'tmp', 'exports');
  fs.mkdirSync(path.join(folder, 'docs'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(folder, 'docs', 'spec.pdf'), REPORT);
  fs.writeFileSync(path.join(folder, 'notes.md'), '# Notes');
  fs.writeFileSync(path.join(outside, 'member-offers.pdf'), REPORT);
  fs.writeFileSync(path.join(outside, 'not-mentioned.pdf'), makePdf(['Private']));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'never shown');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(outside, 'disguised.pdf'));
  const ws = q.createWorkspace({ name: 'PDFs', cwd: folder, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  const { execution, session } = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Exports', worktreePath: folder });
  const reply = (content: string) => q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent', content });
  const { GET } = await import('./route');
  const get = async (requested: string, query: Record<string, string> = {}, id = session.id) => {
    const url = new URL(`http://ri.local/api/sessions/${id}/pdf`);
    url.searchParams.set('path', requested);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await GET(new NextRequest(url), { params: Promise.resolve({ id }) });
    return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()) };
  };
  return { q, folder, outside, execution, session, reply, get };
}

it('serves a PDF the agent shared in a reply: bytes, thumbnail and download', async () => {
  const { outside, session, reply, get } = await setup();
  const report = path.join(outside, 'member-offers.pdf');
  reply(`[Member offers, all cases](${report}) is ready.`);
  const inline = await get(report);
  expect(inline.status).toBe(200);
  expect(inline.headers.get('content-type')).toBe('application/pdf');
  expect(inline.headers.get('content-disposition')).toMatch(/^inline; filename="member-offers.pdf"/);
  expect(inline.body.equals(REPORT)).toBe(true);

  const thumbnail = await get(report, { thumbnail: '1' });
  expect(thumbnail.status).toBe(200);
  expect(thumbnail.headers.get('content-type')).toBe('image/webp');
  expect(thumbnail.headers.get('x-pdf-pages')).toBe('2');

  const download = await get(report, { download: '1' });
  expect(download.headers.get('content-disposition')).toMatch(/^attachment; filename="member-offers.pdf"/);

  // The viewer's URL ends in the file name, and serves the same PDF.
  const { GET: named } = await import('./[...name]/route');
  const url = new URL(`http://ri.local/api/sessions/${session.id}/pdf/member-offers.pdf`);
  url.searchParams.set('path', report);
  const viewer = await named(new NextRequest(url), { params: Promise.resolve({ id: session.id, name: ['member-offers.pdf'] }) });
  expect(viewer.status).toBe(200);
  expect(Buffer.from(await viewer.arrayBuffer()).equals(REPORT)).toBe(true);
}, 30_000);

it('serves PDFs in the chat folder by relative or absolute path, and refuses traversal', async () => {
  const { folder, get } = await setup();
  for (const requested of ['docs/spec.pdf', path.join(folder, 'docs', 'spec.pdf')]) {
    const response = await get(requested);
    expect(response.status).toBe(200);
    expect(response.body.equals(REPORT)).toBe(true);
  }
  expect((await get('../tmp/exports/member-offers.pdf')).status).toBe(400);
  expect((await get('docs/missing.pdf')).status).toBe(404);
});

it('refuses a PDF outside the folder the agent never shared or touched', async () => {
  const { outside, reply, get } = await setup();
  reply(`Made ${path.join(outside, 'member-offers.pdf')}`);
  const response = await get(path.join(outside, 'not-mentioned.pdf'));
  expect(response.status).toBe(403);
  expect(JSON.parse(response.body.toString()).error).toContain("Only files in this chat's folder");
});

it('opens an outside PDF a file tool named, and only PDFs', async () => {
  const { q, outside, session, get } = await setup();
  const named = path.join(outside, 'not-mentioned.pdf');
  q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'tool_call', content: '', toolName: 'Read', toolInput: { file_path: named } });
  expect((await get(named)).status).toBe(200);
  expect((await get('notes.md')).status).toBe(415);
});

it('refuses a symlink named .pdf that leads to another file', async () => {
  const { outside, reply, get } = await setup();
  const disguised = path.join(outside, 'disguised.pdf');
  reply(`See ${disguised}`);
  const response = await get(disguised);
  expect(response.status).toBe(415);
  expect(response.body.toString()).not.toContain('never shown');
});

it('says where the PDF is for a chat on another device', async () => {
  const { q, outside, execution, reply, get } = await setup();
  const grant = q.createDeviceGrant({ kind: 'enroll', deviceId: null, deviceName: 'Laptop', createdByApiKeyId: null });
  const laptop = q.redeemEnrollGrant({ secret: grant.secret, name: 'Laptop' }).device.id;
  q.createPlacement({ executionId: execution.id, deviceId: laptop, startReason: 'created', worktreePath: '/Users/someone/work' });
  const report = path.join(outside, 'member-offers.pdf');
  reply(`Open ${report}`);
  const shared = await get(report);
  expect(shared.status).toBe(409);
  expect(JSON.parse(shared.body.toString()).error).toBe('This PDF is on Laptop.');
  const folderFile = await get('docs/spec.pdf');
  expect(folderFile.status).toBe(409);
  expect(JSON.parse(folderFile.body.toString()).error).toBe("This PDF is on Laptop. PDFs on another device don't preview here yet.");
});

it('answers for a chat that is gone', async () => {
  const { get } = await setup();
  const response = await get('report.pdf', {}, 'missing');
  expect(response.status).toBe(404);
});

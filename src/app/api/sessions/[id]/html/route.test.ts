/**
 * `GET /api/sessions/:id/html`: the preview iframe's document. It opens what
 * the chat's file viewer opens (`src/lib/sessions/session-file-target.ts`),
 * HTML only, and large artifacts stream instead of stopping at the viewer's
 * 1 MiB cap.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { MAX_PREVIEW_BYTES } from '@/lib/workspaces/read-file';

let home: TestHome | undefined;
afterEach(async () => {
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home?.cleanup();
  home = undefined;
});

// A screenshot gallery's shape: a little markup around inline images.
const GALLERY = `<!doctype html><html><body><h1>Member offers</h1>${`<img src="data:image/png;base64,${Buffer.alloc(MAX_PREVIEW_BYTES, 1).toString('base64')}">`.repeat(3)}</body></html>`;

async function setup() {
  home = await createTestHome({ prefix: 'ri-session-html-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  const q = await import('@/lib/db/queries');
  const folder = path.join(home.root, 'worktree');
  const outside = path.join(home.root, 'tmp', 'gallery');
  fs.mkdirSync(path.join(folder, 'reports'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(folder, 'reports', 'summary.html'), '<!doctype html><h1>Summary</h1>');
  fs.writeFileSync(path.join(folder, 'notes.md'), '# Notes');
  fs.writeFileSync(path.join(outside, 'member-offers-all-cases.html'), GALLERY);
  fs.writeFileSync(path.join(outside, 'not-mentioned.html'), '<p>private HTML</p>');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'never shown');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(outside, 'disguised.html'));
  const ws = q.createWorkspace({ name: 'Previews', cwd: folder, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  const { execution, session } = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Gallery', worktreePath: folder });
  const reply = (content: string) => q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent', content });
  const { GET } = await import('./route');
  const get = async (requested: string, opts: { id?: string; theme?: string; download?: boolean } = {}) => {
    const url = new URL(`http://ri.local/api/sessions/${opts.id ?? session.id}/html`);
    url.searchParams.set('path', requested);
    if (opts.theme) url.searchParams.set('theme', opts.theme);
    if (opts.download) url.searchParams.set('download', '1');
    const response = await GET(new NextRequest(url), { params: Promise.resolve({ id: opts.id ?? session.id }) });
    return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()).toString('utf8') };
  };
  return { q, folder, outside, execution, session, reply, get };
}

it('streams the 3 MiB gallery an agent shared in a reply, past the file viewer cap', async () => {
  const { outside, reply, get } = await setup();
  const gallery = path.join(outside, 'member-offers-all-cases.html');
  reply(`[Open the searchable gallery](${gallery}) works offline.`);
  const response = await get(gallery, { theme: 'light' });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-security-policy')).toMatch(/^sandbox allow-scripts; /);
  expect(response.body.length).toBeGreaterThan(GALLERY.length);
  expect(response.body).toContain('<h1>Member offers</h1>');
  expect(response.body).toContain('color-scheme:light');
  expect(response.body.endsWith('</script>')).toBe(true);
});

it('serves HTML in the chat folder by relative or absolute path, and refuses traversal', async () => {
  const { folder, get } = await setup();
  for (const requested of ['reports/summary.html', path.join(folder, 'reports', 'summary.html')]) {
    const response = await get(requested);
    expect(response.status).toBe(200);
    expect(response.body).toContain('<h1>Summary</h1>');
  }
  expect((await get('../tmp/gallery/member-offers-all-cases.html')).status).toBe(400);
  expect(await get('reports/missing.html')).toMatchObject({ status: 404 });
});

it('downloads the file as written, under its own name, with the same reach as the preview', async () => {
  const { outside, reply, get } = await setup();
  const summary = await get('reports/summary.html', { download: true });
  expect(summary.status).toBe(200);
  expect(summary.body).toBe('<!doctype html><h1>Summary</h1>');
  expect(summary.headers.get('content-disposition')).toBe(`attachment; filename="summary.html"; filename*=UTF-8''summary.html`);
  const gallery = path.join(outside, 'member-offers-all-cases.html');
  reply(`[Open the searchable gallery](${gallery}) works offline.`);
  expect((await get(gallery, { download: true })).body).toBe(GALLERY);
  const unshared = await get(path.join(outside, 'not-mentioned.html'), { download: true });
  expect(unshared.status).not.toBe(200);
  expect(unshared.body).not.toContain('private HTML');
  expect(unshared.headers.get('content-disposition')).toBeNull();
});

it('refuses outside HTML the agent never shared or touched', async () => {
  const { outside, reply, get } = await setup();
  reply(`Made ${path.join(outside, 'member-offers-all-cases.html')}`);
  const response = await get(path.join(outside, 'not-mentioned.html'));
  expect(response.status).toBe(403);
  expect(response.body).toContain("Only files in this chat's folder");
  expect(response.body).not.toContain('private HTML');
});

it('opens outside HTML a file tool named, and only HTML', async () => {
  const { q, outside, session, get } = await setup();
  const named = path.join(outside, 'not-mentioned.html');
  q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'tool_call', content: '', toolName: 'Write', toolInput: { file_path: named } });
  expect(await get(named)).toMatchObject({ status: 200 });
  expect((await get(named)).body).toContain('<p>private HTML</p>');
  expect(await get('notes.md')).toMatchObject({ status: 415 });
});

it('refuses a symlink named .html that leads to another file', async () => {
  const { outside, reply, get } = await setup();
  const disguised = path.join(outside, 'disguised.html');
  reply(`See ${disguised}`);
  const response = await get(disguised);
  expect(response.status).toBe(415);
  expect(response.body).not.toContain('never shown');
});

it('says where the file is for a chat on another device', async () => {
  const { q, outside, execution, reply, get } = await setup();
  const grant = q.createDeviceGrant({ kind: 'enroll', deviceId: null, deviceName: 'Laptop', createdByApiKeyId: null });
  const laptop = q.redeemEnrollGrant({ secret: grant.secret, name: 'Laptop' }).device.id;
  q.createPlacement({ executionId: execution.id, deviceId: laptop, startReason: 'created', worktreePath: '/Users/someone/work' });
  const gallery = path.join(outside, 'member-offers-all-cases.html');
  reply(`Open ${gallery}`);
  expect(await get(gallery)).toMatchObject({ status: 409 });
  expect((await get(gallery)).body).toContain('This HTML file is on Laptop.');
  // Its folder files are read by its worker, which isn't connected here.
  const folderFile = await get('reports/summary.html');
  expect(folderFile.status).toBe(409);
  expect(folderFile.body).toContain('Laptop is not connected right now.');
});

it('answers for a chat that is gone', async () => {
  const { get } = await setup();
  const response = await get('index.html', { id: 'missing' });
  expect(response.status).toBe(404);
  expect(response.body).toContain('This chat no longer exists.');
});

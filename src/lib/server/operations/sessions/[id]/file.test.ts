/**
 * `GET /sessions/:id/file` for paths outside the chat's folder: a file chip in
 * the transcript can name a file the agent read or wrote anywhere on the home
 * (a screenshot in /tmp), and the viewer opens it then, and only then
 * (`src/lib/sessions/named-files.ts`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let home: TestHome | undefined;
afterEach(async () => {
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home?.cleanup();
  home = undefined;
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

async function setup() {
  home = await createTestHome({ prefix: 'ri-session-file-outside-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  const q = await import('@/lib/db/queries');
  const folder = path.join(home.root, 'worktree');
  const outside = path.join(home.root, 'elsewhere');
  fs.mkdirSync(path.join(folder, 'src'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(folder, 'src', 'page.tsx'), 'export default 1\n');
  fs.writeFileSync(path.join(outside, 'shot.png'), PNG);
  fs.writeFileSync(path.join(outside, 'notes.md'), '# Notes\n');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'never shown');
  fs.writeFileSync(path.join(outside, 'explorer.html'), '<button>Explore plays</button><script>window.ready=true</script>');
  fs.writeFileSync(path.join(outside, 'not-mentioned.html'), 'private HTML');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(outside, 'disguised.html'));
  const ws = q.createWorkspace({ name: 'Outside files', cwd: folder, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  const { execution, session } = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Screenshots', worktreePath: folder });
  const read = (file: string) =>
    q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'tool_call', content: '', toolName: 'Read', toolInput: { file_path: file } });
  const { GET } = await import('@/lib/server/operations/sessions/[id]/file');
  const get = (p: string, base = false) =>
    GET({ params: { id: session.id }, query: { path: p, ...(base ? { base: '1' } : {}) } }, {} as never);
  return { q, folder, outside, execution, session, read, get };
}

it('opens a file outside the folder that the agent read, image bytes included', async () => {
  const { outside, read, get } = await setup();
  const shot = path.join(outside, 'shot.png');
  read(shot);
  expect(await get(shot)).toMatchObject({
    ok: true,
    data: { path: shot, mime: 'image/png', isBinary: true, encoding: 'base64', content: PNG.toString('base64') },
  });
  // The diff's "old" side has no git base out there.
  expect(await get(shot, true)).toMatchObject({ ok: true, data: { content: '', mime: 'text/plain' } });
});

it('refuses a file outside the folder that no file tool named', async () => {
  const { outside, read, get } = await setup();
  read(path.join(outside, 'notes.md'));
  expect(await get(path.join(outside, 'secret.txt'))).toMatchObject({ ok: false, status: 403, body: { code: 'not_named' } });
  // Traversal is judged where it lands, not by how it starts.
  expect(await get(path.join(outside, '..', 'elsewhere', 'secret.txt'))).toMatchObject({ ok: false, status: 403 });
  expect(await get(path.join(outside, 'notes.md'))).toMatchObject({ ok: true, data: { content: '# Notes\n' } });
});

it('answers a named file that is gone, or a folder, like any other read', async () => {
  const { outside, read, get } = await setup();
  read(path.join(outside, 'gone.png'));
  read(outside);
  expect(await get(path.join(outside, 'gone.png'))).toMatchObject({ ok: false, status: 404, body: { code: 'not_found' } });
  expect(await get(outside)).toMatchObject({ ok: false, status: 400, body: { code: 'is_directory' } });
});

it('reads an absolute path inside the folder as the folder file it is', async () => {
  const { folder, get } = await setup();
  expect(await get(path.join(folder, 'src', 'page.tsx'))).toMatchObject({ ok: true, data: { path: 'src/page.tsx', content: 'export default 1\n' } });
  expect(await get('src/page.tsx')).toMatchObject({ ok: true, data: { path: 'src/page.tsx' } });
  expect(await get('../elsewhere/secret.txt')).toMatchObject({ ok: false, status: 400, body: { code: 'invalid_path' } });
});

it('says where the file is for a chat on another device', async () => {
  const { q, outside, execution, read, get } = await setup();
  const grant = q.createDeviceGrant({ kind: 'enroll', deviceId: null, deviceName: 'Laptop', createdByApiKeyId: null });
  const laptop = q.redeemEnrollGrant({ secret: grant.secret, name: 'Laptop' }).device.id;
  q.createPlacement({ executionId: execution.id, deviceId: laptop, startReason: 'created', worktreePath: '/Users/someone/work' });
  const shot = path.join(outside, 'shot.png');
  read(shot);
  expect(await get(shot)).toMatchObject({ ok: false, status: 409, body: { code: 'elsewhere', error: 'This file is on Laptop.' } });
});

it('opens an HTML artifact the agent supplied in a reply, without requiring a file tool', async () => {
  const { q, outside, session, get } = await setup();
  const html = path.join(outside, 'explorer.html');
  q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent', content: `\uE200visualize\uE202${JSON.stringify({ path: html, mode: 'wide' })}\uE201` });
  expect(await get(html)).toMatchObject({ ok: true, data: { mime: 'text/html', content: '<button>Explore plays</button><script>window.ready=true</script>' } });
  expect(await get(path.join(outside, 'not-mentioned.html'))).toMatchObject({ ok: false, status: 403 });
});

it('accepts a file URL from a reply, but refuses a disguised non-HTML file', async () => {
  const { q, outside, session, get } = await setup();
  const fileUrl = new URL(`file://${path.join(outside, 'explorer.html')}`).href;
  const disguised = path.join(outside, 'disguised.html');
  q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent', content: `[Preview](${fileUrl}) and ${disguised}` });
  expect(await get(fileUrl)).toMatchObject({ ok: true, data: { mime: 'text/html' } });
  expect(await get(disguised)).toMatchObject({ ok: false, status: 415 });
});

it('reports a shared HTML artifact past its cap as too large to draw, which the streamed preview still opens', async () => {
  const { q, outside, session, get } = await setup();
  const gallery = path.join(outside, 'gallery.html');
  fs.writeFileSync(gallery, `<!doctype html>${'<img src="data:image/png;base64,AAAA">'.repeat(60_000)}`);
  q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent', content: `Open ${gallery}` });
  expect(await get(gallery)).toMatchObject({ ok: true, data: { mime: 'text/html', tooLarge: true, content: null } });
});

it('opens Markdown and source files shared in replies, with exact reference matching', async () => {
  const { q, outside, session, get } = await setup();
  const notes = path.join(outside, 'notes.md');
  q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent', content: `[Backup](${notes}.bak) and https://example.com${notes}` });
  expect(await get(notes)).toMatchObject({ ok: false, status: 403 });
  q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent', content: `[Read the notes](${notes})` });
  expect(await get(notes)).toMatchObject({ ok: true, data: { mime: 'text/markdown', content: '# Notes\n' } });
  expect(await get(path.join(outside, 'secret.txt'))).toMatchObject({ ok: false, status: 403 });
  const code = path.join(outside, 'example.ts');
  fs.writeFileSync(code, 'export const ready = true;');
  q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent', content: `Open \`${code}\`.` });
  expect(await get(code)).toMatchObject({ ok: true, data: { content: 'export const ready = true;' } });
});

it('handles missing, oversized and disguised text files without reading unrelated files', async () => {
  const { q, outside, session, get } = await setup();
  const large = path.join(outside, 'large.md');
  const gone = path.join(outside, 'gone.md');
  const disguised = path.join(outside, 'image.md');
  fs.writeFileSync(large, 'a'.repeat(1024 * 1024 + 1));
  fs.symlinkSync(path.join(outside, 'shot.png'), disguised);
  q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent', content: `[Large](${large}) [Gone](${gone}) [Disguised](${disguised})` });
  expect(await get(large)).toMatchObject({ ok: true, data: { tooLarge: true, content: null } });
  expect(await get(gone)).toMatchObject({ ok: false, status: 404 });
  expect(await get(disguised)).toMatchObject({ ok: false, status: 415 });
});

it('opens relative files from an agent main chat in its own folder', async () => {
  const { q, folder, session } = await setup();
  fs.writeFileSync(path.join(folder, 'README.md'), '# Agent notes');
  const main = q.createChatSession({ workspaceId: session.workspaceId, harness: 'claude', type: 'orchestration' });
  const { GET } = await import('@/lib/server/operations/sessions/[id]/file');
  expect(await GET({ params: { id: main.id }, query: { path: 'README.md' } }, {} as never)).toMatchObject({ ok: true, data: { content: '# Agent notes' } });
  expect(await GET({ params: { id: main.id }, query: { path: '../elsewhere/secret.txt' } }, {} as never)).toMatchObject({ ok: false, status: 400 });
});

it('downloads original text bytes past the preview cap with the same access checks', async () => {
  const { q, outside, session, get } = await setup();
  const file = path.join(outside, 'My Notes.md');
  const bytes = Buffer.concat([Buffer.from('\uFEFF# Notes\r\n'), Buffer.alloc(1024 * 1024 + 1, 97)]);
  fs.writeFileSync(file, bytes);
  q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent', content: `[Notes](<${file}>)` });
  expect(await get(file)).toMatchObject({ ok: true, data: { tooLarge: true, content: null } });
  const { downloadSessionFile } = await import('@/lib/sessions/file-download');
  const request = new Request('http://ri.local/download');
  const response = await downloadSessionFile(request, session.id, file);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-disposition')).toContain('attachment; filename="My Notes.md"');
  expect(response.headers.get('content-type')).toBe('application/octet-stream');
  expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
  expect((await downloadSessionFile(request, session.id, path.join(outside, 'secret.txt'))).status).toBe(403);
  expect((await downloadSessionFile(request, session.id, '../elsewhere/secret.txt')).status).toBe(400);
  const other = q.createChatSession({ workspaceId: session.workspaceId, harness: 'claude', type: 'orchestration' });
  expect((await downloadSessionFile(request, other.id, file)).status).toBe(403);
});

it('downloads relative text from an agent main chat and reports a missing file', async () => {
  const { q, folder, session } = await setup();
  fs.writeFileSync(path.join(folder, 'README.md'), '# Agent notes\n');
  const main = q.createChatSession({ workspaceId: session.workspaceId, harness: 'claude', type: 'orchestration' });
  const { downloadSessionFile } = await import('@/lib/sessions/file-download');
  const request = new Request('http://ri.local/download');
  const file = await downloadSessionFile(request, main.id, 'README.md');
  expect(file.status).toBe(200);
  expect(await file.text()).toBe('# Agent notes\n');
  expect((await downloadSessionFile(request, main.id, 'missing.md')).status).toBe(404);
  expect((await downloadSessionFile(request, main.id, 'archive.zip')).status).toBe(404);
});

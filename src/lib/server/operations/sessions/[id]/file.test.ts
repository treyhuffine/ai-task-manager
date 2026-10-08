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

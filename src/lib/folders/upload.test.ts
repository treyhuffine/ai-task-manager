import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { POST as uploadAgent } from '@/app/api/workspaces/[id]/file/upload/route';
import { POST as uploadChat } from '@/app/api/sessions/[id]/file/upload/route';
import { MAX_FILE_BYTES } from '@/lib/api/limited-body';

let home: TestHome;
let folder: string;
let workspaceId: string;
let chatId: string;

beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1');
  home = await createTestHome({ prefix: 'ri-folder-upload-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  folder = path.join(home.root, 'project');
  fs.mkdirSync(folder);
  const q = await import('@/lib/db/queries');
  workspaceId = q.createWorkspace({ name: 'Project', cwd: folder, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
  chatId = q.createExecutionWithChat({ workspaceId, harness: 'claude', label: null }).session.id;
});

afterEach(async () => {
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
  vi.unstubAllEnvs();
});

function upload(kind: 'agent' | 'chat', destination: string, bytes = new Uint8Array([0, 255, 128, 10])) {
  const id = kind === 'agent' ? workspaceId : chatId;
  const form = new FormData();
  form.append('path', destination);
  form.append('file', new Blob([bytes]), 'original.bin');
  const request = new Request(`http://ri.local/api/${kind === 'agent' ? 'workspaces' : 'sessions'}/${id}/file/upload`, { method: 'POST', body: form });
  return (kind === 'agent' ? uploadAgent : uploadChat)(request, { params: Promise.resolve({ id }) });
}

it.each(['agent', 'chat'] as const)('uploads binary bytes and empty files to an %s folder', async (kind) => {
  expect((await upload(kind, '資料/a file.bin')).status).toBe(200);
  expect(fs.readFileSync(path.join(folder, '資料/a file.bin'))).toEqual(Buffer.from([0, 255, 128, 10]));
  expect((await upload(kind, 'empty.txt', new Uint8Array())).status).toBe(200);
  expect(fs.statSync(path.join(folder, 'empty.txt')).size).toBe(0);
});

it('keeps the existing file on a name collision', async () => {
  fs.writeFileSync(path.join(folder, 'keep.txt'), 'original');
  const response = await upload('agent', 'keep.txt');
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'exists' });
  expect(fs.readFileSync(path.join(folder, 'keep.txt'), 'utf8')).toBe('original');
});

it.each(['../escape.bin', '/tmp/escape.bin'])('rejects a path outside the folder: %s', async (destination) => {
  expect((await upload('chat', destination)).status).toBe(400);
  expect(fs.existsSync(path.join(home.root, 'escape.bin'))).toBe(false);
});

it('refuses uploads to an archived agent', async () => {
  (await import('@/lib/db/queries')).archiveWorkspace(workspaceId);
  expect((await upload('agent', 'new.bin')).status).toBe(409);
  expect(fs.existsSync(path.join(folder, 'new.bin'))).toBe(false);
});

it('rejects an oversized file without creating anything', async () => {
  expect((await upload('agent', 'large.bin', new Uint8Array(MAX_FILE_BYTES + 1))).status).toBe(413);
  expect(fs.existsSync(path.join(folder, 'large.bin'))).toBe(false);
});

it('requires a file and destination and handles a malformed form', async () => {
  const context = { params: Promise.resolve({ id: workspaceId }) };
  const request = (body: BodyInit, headers?: HeadersInit) => new Request('http://ri.local/upload', { method: 'POST', body, headers });
  expect((await uploadAgent(request(new FormData()), context)).status).toBe(400);
  expect((await uploadAgent(request('{}', { 'content-type': 'application/json' }), context)).status).toBe(400);
  expect((await uploadAgent(request('broken', { 'content-type': 'multipart/form-data; boundary=missing' }), context)).status).toBe(400);
});

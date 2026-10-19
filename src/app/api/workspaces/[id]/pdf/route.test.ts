/**
 * `GET /api/workspaces/:id/pdf`: a PDF in an agent's own folder, for its
 * Files tab. The same reach as the folder's file viewer: inside the folder.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { makePdf } from '@/test/fixtures/pdf';

let home: TestHome | undefined;
afterEach(async () => {
  await home?.cleanup();
  home = undefined;
});

const SPEC = makePdf(['Spec']);

async function setup() {
  home = await createTestHome({ prefix: 'ri-workspace-pdf-' });
  const q = await import('@/lib/db/queries');
  const folder = path.join(home.root, 'agent');
  fs.mkdirSync(path.join(folder, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'docs', 'spec.pdf'), SPEC);
  fs.writeFileSync(path.join(home.root, 'outside.pdf'), makePdf(['Outside']));
  const ws = q.createWorkspace({ name: 'Docs', cwd: folder, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  const { GET } = await import('./route');
  const get = async (requested: string, id = ws.id, query: Record<string, string> = {}) => {
    const url = new URL(`http://ri.local/api/workspaces/${id}/pdf`);
    url.searchParams.set('path', requested);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await GET(new NextRequest(url), { params: Promise.resolve({ id }) });
    return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()) };
  };
  return { folder, ws, get };
}

it("serves a PDF from the agent's folder, and its first page", async () => {
  const { ws, get } = await setup();
  const response = await get('docs/spec.pdf');
  expect(response.status).toBe(200);
  expect(response.body.equals(SPEC)).toBe(true);
  const thumbnail = await get('docs/spec.pdf', ws.id, { thumbnail: '1' });
  expect(thumbnail.headers.get('content-type')).toBe('image/webp');
}, 30_000);

it('stays inside the folder', async () => {
  const { folder, get } = await setup();
  expect((await get('../outside.pdf')).status).toBe(400);
  expect((await get(path.join(folder, '..', 'outside.pdf'))).status).toBe(400);
  expect((await get('docs/spec.txt')).status).toBe(415);
});

it('answers for a missing agent or folder', async () => {
  const { folder, get } = await setup();
  expect((await get('docs/spec.pdf', 'missing')).status).toBe(404);
  fs.rmSync(folder, { recursive: true });
  const response = await get('docs/spec.pdf');
  expect(response.status).toBe(409);
  expect(JSON.parse(response.body.toString()).error).toContain("The agent's folder does not exist");
});

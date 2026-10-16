/**
 * `GET /api/workspaces/:id/html`: an HTML file in an agent's own folder,
 * served as its preview iframe's document. The same reach as the folder's
 * file viewer: inside the folder only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let home: TestHome | undefined;
afterEach(async () => {
  await home?.cleanup();
  home = undefined;
});

async function setup() {
  home = await createTestHome({ prefix: 'ri-workspace-html-' });
  const q = await import('@/lib/db/queries');
  const folder = path.join(home.root, 'agent');
  fs.mkdirSync(path.join(folder, 'site'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'site', 'index.html'), `<!doctype html><h1>Site</h1>${'<p>row</p>'.repeat(200_000)}`);
  fs.writeFileSync(path.join(home.root, 'outside.html'), '<p>outside</p>');
  const ws = q.createWorkspace({ name: 'Site', cwd: folder, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  const { GET } = await import('./route');
  const get = async (requested: string, id = ws.id) => {
    const url = new URL(`http://ri.local/api/workspaces/${id}/html`);
    url.searchParams.set('path', requested);
    const response = await GET(new NextRequest(url), { params: Promise.resolve({ id }) });
    return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()).toString('utf8') };
  };
  return { folder, ws, get };
}

it("streams HTML from the agent's folder, larger than the file viewer cap", async () => {
  const { get } = await setup();
  const response = await get('site/index.html');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-security-policy')).toMatch(/^sandbox allow-scripts; /);
  expect(response.body.length).toBeGreaterThan(1024 * 1024);
  expect(response.body).toContain('<h1>Site</h1>');
});

it('stays inside the folder', async () => {
  const { folder, get } = await setup();
  expect(await get('../outside.html')).toMatchObject({ status: 400 });
  expect(await get(path.join(folder, '..', 'outside.html'))).toMatchObject({ status: 400 });
  expect((await get('../outside.html')).body).not.toContain('<p>outside</p>');
});

it('answers for a missing agent or folder', async () => {
  const { folder, get } = await setup();
  expect(await get('site/index.html', 'missing')).toMatchObject({ status: 404 });
  fs.rmSync(folder, { recursive: true });
  const response = await get('site/index.html');
  expect(response.status).toBe(409);
  expect(response.body).toContain("The agent's folder does not exist");
});

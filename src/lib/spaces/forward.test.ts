/**
 * A team's space inside My Ri reaching its team through this home
 * (docs/homes-spec.md §3.2, §9.3, P7.1): only the personal owner, only the
 * team's typed API and files, as this person's member, with nothing personal
 * passed along. The team runs in a process of its own over real HTTP.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_KEY_ID_HEADER, API_KEY_SCOPE_HEADER } from '@/lib/auth/request-key';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startTeamProcess, type TeamProcess } from '@/test/fixtures/team-process';
import { createHash } from 'node:crypto';

let team: TeamProcess;
let teamRoot: string;
let home: TestHome;

beforeAll(async () => {
  teamRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-p7-forward-team-'));
  team = await startTeamProcess(teamRoot, 'Acme', 'Trey');
}, 90_000);

afterAll(async () => {
  await team?.stop();
  fs.rmSync(teamRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-p7-forward-home-' });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await home.cleanup();
});

async function owner() {
  const { teamTRPC } = await import('./remote');
  return teamTRPC(team.url, team.ownerToken);
}

async function connected(name: string) {
  const { connectTeam } = await import('./connect');
  return connectTeam({ link: (await (await owner()).team.invitations.create.mutate()).link, name });
}

/** A request as the proxy hands it to the route: with the caller's key scope, never their key. */
async function viaHome(teamId: string, rest: string, init: { method?: string; scope?: string; body?: BodyInit; headers?: Record<string, string> } = {}) {
  const { GET, POST } = await import('@/app/api/space/[teamId]/[...path]/route');
  const url = new URL(`http://my-ri.test/api/space/${teamId}/${rest}`);
  const headers = new Headers(init.headers);
  headers.set(API_KEY_ID_HEADER, 'personal-key');
  if (init.scope) headers.set(API_KEY_SCOPE_HEADER, init.scope);
  headers.set('cookie', 'ri_session=personal-secret');
  const request = new NextRequest(url, { method: init.method ?? 'GET', headers, body: init.body });
  const handler = (init.method ?? 'GET') === 'POST' ? POST : GET;
  return handler(request, { params: Promise.resolve({ teamId, path: url.pathname.split('/').slice(4).map(decodeURIComponent) }) });
}

describe('a team space reaching its team through My Ri', () => {
  it('preserves binary uploads and explicitly published files through the Team proxy', async () => {
    const connection = await connected('Binary reviewer');
    const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(Array.from({ length: 8192 }, (_, index) => index % 256))]);
    const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
    const form = new FormData();
    form.append('file', new File([bytes], 'binary-result.pdf', { type: 'application/pdf' }));
    const uploaded = await viaHome(connection.id, 'attachments', { method: 'POST', body: form });
    expect(uploaded.status).toBe(201);
    const file = await uploaded.json();
    const downloaded = await viaHome(connection.id, `attachments/${file.fileName}`);
    expect(hash(new Uint8Array(await downloaded.arrayBuffer()))).toBe(hash(bytes));
    const task = await (await owner()).tasks.create.mutate({ title: 'Binary publication', rawInput: 'Binary publication' });
    const published = await viaHome(connection.id, 'trpc/tasks.publishResult', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskId: task.id, requestId: 'binary-through-proxy', summary: 'Chosen binary result', attachments: [file] }) });
    expect(published.status, await published.clone().text()).toBe(200);
    const saved = (await (await owner()).tasks.publishedResults.query({ taskId: task.id }))[0];
    expect(saved.attachments).toHaveLength(1);
    const resultFile = await viaHome(connection.id, `attachments/${saved.attachments![0].fileName}`);
    expect(hash(new Uint8Array(await resultFile.arrayBuffer()))).toBe(hash(bytes));
  });
  it('refuses an old document after its connected member changes without forwarding the typed payload', async () => {
    const original = await connected('Original member');
    const {disconnectTeam} = await import('./connect');
    await disconnectTeam(original.id);
    const replacement = await connected('Replacement member');
    expect(replacement.id).toBe(original.id);expect(replacement.memberId).not.toBe(original.memberId);
    const headers={'x-ri-document-home':original.id,'x-ri-document-viewer':original.memberId};
    const response = await viaHome(original.id,'trpc/tasks.create',{method:'POST',headers,body:JSON.stringify({title:'Must stay with its author',rawInput:'Must stay with its author'})});
    expect(response.status).toBe(403);expect(await response.json()).toMatchObject({error:'document_author_changed'});
    expect((await (await owner()).tasks.list.query({})).some(task=>task.title==='Must stay with its author')).toBe(false);
    expect((await viaHome(replacement.id,'trpc/team.me?input=%7B%7D',{headers:{'x-ri-document-home':replacement.id,'x-ri-document-viewer':replacement.memberId}})).status).toBe(200);
  });

  async function activeSvg() {
    const connection = await connected('File reviewer');
    const form = new FormData();
    form.append('file', new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>document.documentElement.setAttribute("data-probe", localStorage.getItem("personal-probe"))</script></svg>'], 'active.svg', { type: 'image/svg+xml' }));
    const uploaded = await viaHome(connection.id, 'attachments', { method: 'POST', body: form });
    expect(uploaded.status).toBe(201);
    const file = await uploaded.json();
    return viaHome(connection.id, `attachments/${file.fileName}`);
  }

  it('isolates active team attachments from the personal origin and rechecks access on every read', async () => {
    const response = await activeSvg();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/svg+xml');
    expect(response.headers.get('content-security-policy')).toMatch(/^sandbox;/);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('no-store');
  }, 60_000);

  it('enforces isolation even when the upstream supplies executable HTML and permissive headers', async () => {
    const connection = await connected('Untrusted response');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<script>window.ran=true</script>', {
      headers: { 'content-type': 'text/html', 'content-security-policy': 'sandbox allow-scripts allow-same-origin', 'cache-control': 'public, max-age=31536000' },
    }));
    const response = await viaHome(connection.id, 'trpc/team.me');
    expect(response.headers.get('content-security-policy')).toMatch(/^sandbox;/);
    expect(response.headers.get('content-security-policy')).not.toContain('allow-scripts');
    expect(response.headers.get('cache-control')).toBe('no-store');
  }, 60_000);

  it.skipIf(process.env.RI_SPACES_BROWSER_TEST !== '1')('a team SVG cannot read the personal origin in Chromium', async () => {
    const response = await activeSvg();
    const bytes = Buffer.from(await response.arrayBuffer());
    const server = http.createServer((req, res) => {
      if (req.url === '/attachment') {
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(bytes);
      } else { res.setHeader('content-type', 'text/html'); res.end('<p>Personal test home</p>'); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true, executablePath: process.env.RI_REVIEW_CHROMIUM });
    try {
      const page = await browser.newPage();
      const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      await page.goto(origin);
      await page.evaluate(() => localStorage.setItem('personal-probe', 'disposable-only'));
      await page.goto(`${origin}/attachment`);
      expect(await page.locator('svg').getAttribute('data-probe')).toBeNull();
    } finally {
      await browser.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 60_000);

  it('reaches the team as this person, through the typed API', async () => {
    const connection = await connected('Maya');
    const res = await viaHome(connection.id, 'trpc/team.me?input=%7B%7D');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { data: { member: { name: string } } } };
    expect(body.result.data.member.name).toBe('Maya');

    const created = await viaHome(connection.id, 'trpc/tasks.create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'From My Ri', rawInput: 'From My Ri' }),
    });
    expect(created.status).toBe(200);
    const tasks = await (await owner()).tasks.list.query({});
    expect(tasks.map((t) => t.title)).toContain('From My Ri');
  }, 60_000);

  it("takes only the personal owner's requests, to the team's API and files only", async () => {
    const connection = await connected('Ann');
    expect((await viaHome(connection.id, 'trpc/team.me', { scope: 'worker' })).status).toBe(403);
    expect((await viaHome(connection.id, 'trpc/team.me', { scope: 'session' })).status).toBe(403);
    expect((await viaHome(connection.id, 'team/host/status')).status).toBe(404);
    expect((await viaHome(connection.id, 'trpc/team.me/../../workspaces')).status).toBe(404);
    expect((await viaHome('not-a-connected-team', 'trpc/team.me')).status).toBe(404);
  }, 60_000);

  it("says when the team stops accepting this Ri, and ends the connection", async () => {
    const connection = await connected('Bo');
    await (await owner()).team.removeMember.mutate({ id: connection.memberId });
    const res = await viaHome(connection.id, 'trpc/team.me?input=%7B%7D');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'team_signed_out' });
    const q = await import('@/lib/db/queries');
    expect(q.getTeamConnection(connection.id)?.status).toBe('revoked');
    expect((await viaHome(connection.id, 'trpc/team.me')).status).toBe(404);
  }, 60_000);

  it('says when the team is out of reach, and keeps the connection', async () => {
    const connection = await connected('Cy');
    const q = await import('@/lib/db/queries');
    q.saveTeamConnection({ ...connection, url: 'http://127.0.0.1:9' });
    const res = await viaHome(connection.id, 'trpc/team.me?input=%7B%7D');
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'team_unreachable' });
    expect(q.getTeamConnection(connection.id)?.status).toBe('active');
  }, 60_000);
});

it('refuses signed-agent pending-input relay before forwarding, including batches', async () => {
  const team = await connected('Human');
  const { SESSION_CREDENTIAL_HEADER } = await import('@/lib/orchestrator/session-credential');
  for (const procedure of ['sessions.pendingInputRequestIdPost', 'team.me,sessions.pendingInputRequestIdPost']) {
    const response = await viaHome(team.id, `trpc/${procedure}`, { method: 'POST', headers: { [SESSION_CREDENTIAL_HEADER]: 'signed-agent-marker', 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ message: expect.stringContaining('Only a signed-in person') });
  }
});

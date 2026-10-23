import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startTeamProcess, type TeamProcess } from '@/test/fixtures/team-process';
import { teamTRPC } from './remote';
import { connectTeam } from './connect';
import { syncAllTeams, requestTeamSync } from './sync';
import * as q from '@/lib/db/queries';
let a: TeamProcess, b: TeamProcess, home: TestHome;
let roots: string[];
beforeAll(async () => {
  roots = ['a', 'b'].map(name => fs.mkdtempSync(path.join(os.tmpdir(), `ri-sync-failure-${name}-`)));
  [a, b] = await Promise.all(roots.map(root => startTeamProcess(root, 'Same name')));
}, 120_000);
afterAll(async () => { await Promise.all([a?.stop(), b?.stop()]); roots?.forEach(root => fs.rmSync(root, { recursive: true, force: true })); });
beforeEach(async () => { home = await createTestHome(); });
afterEach(async () => { vi.restoreAllMocks(); await home.cleanup(); });
async function connect(team: TeamProcess) {
  const owner = teamTRPC(team.url, team.ownerToken);
  const connection = await connectTeam({ link: (await owner.team.invitations.create.mutate()).link, name: 'Maya' });
  await owner.tasks.create.mutate({ title: 'Assigned work', rawInput: 'Assigned work', assigneeMemberId: connection.memberId });
  return connection;
}
it.each(['502 HTML', 'tRPC 500', 'BAD_REQUEST'] as const)('records %s for one team, continues another and clears failure on Retry', async failure => {
  const ca = await connect(a), cb = await connect(b);
  const fetcher = globalThis.fetch;
  const bad = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    if (String(url).startsWith(a.url) && String(url).includes('/api/trpc/')) {
      if (failure === '502 HTML') return Promise.resolve(new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }));
      return Promise.resolve(Response.json({ error: { message: failure, code: failure === 'BAD_REQUEST' ? -32600 : -32603, data: { code: failure === 'BAD_REQUEST' ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR', httpStatus: failure === 'BAD_REQUEST' ? 400 : 500 } } }, { status: failure === 'BAD_REQUEST' ? 400 : 500 }));
    }
    return fetcher(url, init);
  });
  expect(await syncAllTeams()).toEqual([expect.objectContaining({ teamId: ca.id, ok: false, problem: expect.any(String) }), expect.objectContaining({ teamId: cb.id, ok: true, active: 1 })]);
  expect(q.getTeamConnection(ca.id)).toMatchObject({ lastError: expect.any(String), lastErrorAt: expect.any(String) });
  expect(q.getTaskProjection(cb.id, q.listTaskProjections(cb.id)[0].sourceTaskId!)?.sourceState).toBe('active');
  bad.mockRestore();
  expect(await requestTeamSync({ minIntervalMs: 0 })).toEqual([expect.objectContaining({ teamId: ca.id, ok: true }), expect.objectContaining({ teamId: cb.id, ok: true })]);
  expect(q.getTeamConnection(ca.id)?.lastError).toBeNull();
}, 30_000);
it('includes a team connected during an active pass in an immediate follow-up', async () => {
  const ca = await connect(a);
  const arrived = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const fetcher = globalThis.fetch;
  let held = false;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const response = await fetcher(url, init);
    if (!held && String(url).startsWith(a.url) && String(url).includes('team.me')) { held = true; arrived.resolve(); await release.promise; }
    return response;
  });
  const first = requestTeamSync({ minIntervalMs: 0 }); await arrived.promise;
  const cb = await connect(b);
  const followUp = requestTeamSync({ minIntervalMs: 0, includeNewConnections: true }); release.resolve();
  expect(await followUp).toEqual([expect.objectContaining({ teamId: ca.id, ok: true }), expect.objectContaining({ teamId: cb.id, ok: true })]);
  await first; expect(q.listTaskProjections(cb.id)).toHaveLength(1);
}, 30_000);

it('measures the steady two-minute pass without rereading unchanged assigned bodies', async () => {
  const connection = await connect(a), owner = teamTRPC(a.url, a.ownerToken);
  for (let i = 0; i < 20; i++) await owner.tasks.create.mutate({ title: `Assigned ${i}`, rawInput: `Assigned ${i}`, assigneeMemberId: connection.memberId });
  const { addTeamTaskToMyWork, saveTeamNoteToMyNotes, syncTeam } = await import('./sync');
  for (let i = 0; i < 30; i++) { const task = await owner.tasks.create.mutate({ title: `Added ${i}`, rawInput: `Added ${i}` }); await addTeamTaskToMyWork(connection.id, task.id); }
  for (let i = 0; i < 15; i++) { const note = await owner.notes.create.mutate({ title: `Saved note ${i}`, body: 'Reference text' }); await saveTeamNoteToMyNotes(connection.id, note.id); }
  await syncTeam(connection.id);
  const fetcher = globalThis.fetch;
  const requests: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => { if (String(url).startsWith(a.url)) requests.push(new URL(String(url)).pathname); return fetcher(url, init); });
  const before = performance.now();
  expect(await syncTeam(connection.id)).toMatchObject({ ok: true, changed: 0 });
  expect(requests.filter(path => path.endsWith('/tasks.get'))).toHaveLength(0);
  expect(requests.filter(path => path.endsWith('/notes.get'))).toHaveLength(0);
  expect(requests).toHaveLength(5);
  console.info(JSON.stringify({ fixture: '21 unchanged assignments, 30 deliberately added tasks, 15 saved notes', requests: requests.length, elapsedMs: Math.round(performance.now() - before) }));
}, 30_000);

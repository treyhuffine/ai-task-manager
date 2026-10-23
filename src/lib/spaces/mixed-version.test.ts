/** Actual baseline-main server, disposable Homes, no provider discovery. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { startTeamProcess } from '@/test/fixtures/team-process';
import { createTestHome } from '@/test/fixtures/home';
import { teamTRPC } from './remote';
import { connectTeam } from './connect';
import { syncTeam } from './sync';
import { runAction } from '@/lib/orchestrator/dispatch';
import { ensureHomeIdentity } from '@/lib/home/identity';
import { API_PROTOCOL_HEADER } from '@/lib/releases/api-contract';

it.skipIf(!process.env.RI_REVIEW_MAIN_REPO)('explains an older Team server and advertises no unavailable native operations', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-main-version-'));
  const server = await startTeamProcess(root, 'Older Team', 'Owner', { repo: process.env.RI_REVIEW_MAIN_REPO });
  const home = await createTestHome({ prefix: 'ri-version-personal-' });
  const originalFetch = globalThis.fetch;
  try {
    ensureHomeIdentity();
    // Set up the existing membership using the baseline wire protocol, as
    // before this personal Home was upgraded. Subsequent calls use protocol 2.
    vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers); headers.set(API_PROTOCOL_HEADER, '1');
      return originalFetch(input, { ...init, headers });
    });
    const owner = teamTRPC(server.url, server.ownerToken);
    const connection = await connectTeam({ link: (await owner.team.invitations.create.mutate()).link, name: 'Member' });
    vi.unstubAllGlobals();
    const synced = await syncTeam(connection.id);
    expect(synced).toMatchObject({ ok: false, problem: expect.stringMatching(/different version|Update.*older/) });
    const discovery = await runAction('list_homes', {}, { remote: false, caller: { location: 'home' } });
    expect(discovery).toMatchObject({ ok: true, result: { connected_homes: [expect.objectContaining({ id: connection.id, operations: [] })] } });
    const write = await runAction('create_task', { target_home_id: connection.id, title: 'No fallback', idempotency_key: 'older-server-write' }, { remote: false, caller: { location: 'home' } });
    expect(write.ok).toBe(false);
    expect(JSON.stringify(write)).toMatch(/different version|Update.*older/);
  } finally {
    vi.unstubAllGlobals(); await home.cleanup(); await server.stop(); fs.rmSync(root, { recursive: true, force: true });
  }
}, 90_000);

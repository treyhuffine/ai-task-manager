// Review-10 probe: personal launch with a remembered model the live catalog no longer offers.
// main 17a58dbb dispatchExecutionSession repaired it (resolveStartSelection(..., { repairInvalidModel: true })).
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getProvider } from '@agentex/agent';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { clearHarnessModelCache } from '@/lib/harness/model-discovery';
import * as q from '@/lib/db/queries';

let home: TestHome; let fake: FakeHarness;
beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1');
  home = await createTestHome({ prefix: 'ri-uh10-stale-' });
  fake = installFakeHarness('claude'); fake.modelId = 'opus';
  getProvider('claude').listModels = async () => [{ id: 'opus', name: 'Opus', serviceTiers: [{ id: 'default', name: 'Normal', availability: 'available' }] }] as never;
  clearHarnessModelCache();
});
afterEach(async () => { fake.restore(); await home.cleanup(); vi.unstubAllEnvs(); });

it('personal launch with a remembered model the catalog dropped', async () => {
  const cwd = path.join(home.root, 'p'); fs.mkdirSync(cwd);
  const ws = q.createWorkspace({ name: 'Plain', cwd, isGit: false } as never);
  const { dispatchExecutionSession } = await import('@/lib/sessions/dispatch');
  const { resolveStartSelection } = await import('@/lib/harness/start-selection');
  const mainBehavior = await resolveStartSelection({ providerId: 'claude', model: 'claude-retired-model' }, { cwd, repairInvalidModel: true }).then(s => ({ ok: true, model: s.model }), e => ({ ok: false, error: String(e.message) }));
  const branch = await dispatchExecutionSession({ workspaceId: ws.id, harness: 'claude', model: 'claude-retired-model' }).then(s => ({ ok: true, model: s.model }), e => ({ ok: false, error: String(e.message) }));
  expect(mainBehavior).toEqual({ ok: true, model: 'opus' });
  expect(branch).toEqual({ ok: true, model: 'opus' });
}, 60_000);

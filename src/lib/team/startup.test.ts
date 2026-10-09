/**
 * A team's first start through the real boot (`instrumentation.ts`): it
 * resolves the team before any personal work, so nothing personal is made
 * or started, from the first start (docs/homes-spec.md §9.1, §9.2, P6.3).
 *
 * Every harness is installed and signed in, an API key is in the
 * environment, and there's a Claude session on disk to import (P6.5): a
 * team touches none of them, where a personal home finds them all.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getProvider, registerProvider } from '@agentex/agent';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { HARNESS_REGISTRY, type HarnessId } from '@/lib/harness/registry';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let home: TestHome;
let harnesses: FakeHarness[] = [];
/** Every reach into a harness: auth, runtime probe, model list and sessions. */
let harnessCalls: string[] = [];
const savedEnv: Record<string, string | undefined> = {};
const CLAUDE_SESSION = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

/** Every harness installed and signed in, each reach into it counted. */
function signedInHarnesses() {
  harnessCalls = [];
  harnesses = (Object.keys(HARNESS_REGISTRY) as HarnessId[]).map((id) => {
    const fake = installFakeHarness(id);
    const provider = getProvider(fake.providerType);
    const counted = <A extends unknown[], R>(name: string, fn: ((...args: A) => R) | undefined) => (...args: A): R => {
      harnessCalls.push(`${id} ${name}`);
      return fn!(...args);
    };
    registerProvider({
      ...provider,
      resolveAuth: counted('auth', provider.resolveAuth),
      probeCapabilities: counted('probe', provider.probeCapabilities),
      listModels: counted('models', provider.listModels),
      createSession: counted('session', provider.createSession),
    });
    return fake;
  });
}

/** A Claude Code session on this computer, as chat import would find it. */
function claudeHistory(root: string) {
  const claudeHome = path.join(root, 'claude-home');
  const project = path.join(root, 'project');
  fs.mkdirSync(project, { recursive: true });
  const dir = path.join(claudeHome, 'projects', '-project');
  fs.mkdirSync(dir, { recursive: true });
  const line = (record: object) => JSON.stringify(record);
  fs.writeFileSync(path.join(dir, `${CLAUDE_SESSION}.jsonl`), [
    line({ type: 'user', uuid: 'u1', sessionId: CLAUDE_SESSION, cwd: project, timestamp: '2026-10-01T10:00:00.000Z', isSidechain: false, message: { role: 'user', content: 'Plan the move' } }),
    line({ type: 'assistant', uuid: 'a1', sessionId: CLAUDE_SESSION, cwd: project, timestamp: '2026-10-01T10:00:01.000Z', message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'Here is a plan.' }] } }),
  ].join('\n') + '\n');
  return { CLAUDE_CONFIG_DIR: claudeHome, CODEX_HOME: path.join(root, 'codex-home') };
}

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-team-boot-', openDb: false });
  const env = { NEXT_RUNTIME: 'nodejs', OPENAI_API_KEY: 'sk-test-ambient', ANTHROPIC_API_KEY: 'sk-ant-test-ambient', ...claudeHistory(home.root) };
  for (const [key, value] of Object.entries(env)) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }
  delete process.env.RI_MIRROR_DISABLED;
  signedInHarnesses();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  (await import('@/lib/home/authority')).resetAuthorityCache();
});

afterEach(async () => {
  for (const fake of harnesses.splice(0)) fake.restore();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  (await import('@/lib/home/authority')).resetAuthorityCache();
  await home.cleanup();
});

it('starts a team as a team, with nothing personal made or started', async () => {
  const { writeTeamIntent } = await import('@/lib/home/team-intent');
  writeTeamIntent({ creationId: 'boot-create-1', name: 'Family' });
  const { register } = await import('../../../instrumentation');
  await register();

  const q = await import('@/lib/db/queries');
  expect(q.getHome()).toMatchObject({ kind: 'team', name: 'Family' });
  // No personal schedules were seeded: the morning deck, stream triage and
  // the heartbeat are a person's (src/lib/deck/trigger.ts and friends).
  expect(q.listTriggers()).toEqual([]);
  // No persona, memory, orchestrator brief or markdown mirror in a team's folder.
  for (const file of ['USER.md', 'SOUL.md', 'MEMORY.md', 'AGENTS.md']) {
    expect(fs.existsSync(path.join(home.root, file)), file).toBe(false);
  }
  q.createTask({ title: 'Shared', rawInput: 'Shared' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(fs.existsSync(path.join(home.root, 'tasks'))).toBe(false);
  // The scheduler refuses to start in a team, so nothing started it.
  const { startScheduler } = await import('@/lib/scheduler/runner');
  expect(() => startScheduler()).toThrow(/team space/);

  // With every harness signed in and a session on disk, nothing reached
  // for them: no probe, model list or session, and no chat imported.
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(harnessCalls).toEqual([]);
  const { getDb } = await import('@/lib/db');
  const { chatSessions, externalSessionImports } = await import('@/lib/db/schema');
  expect(getDb().select().from(chatSessions).all()).toEqual([]);
  expect(getDb().select().from(externalSessionImports).all()).toEqual([]);
});

it('starts a personal home as before, where the same harnesses and history are found', async () => {
  const { register } = await import('../../../instrumentation');
  await register();
  const q = await import('@/lib/db/queries');
  expect(q.getHome()?.kind).toBe('personal');
  expect(q.listTriggers().length).toBeGreaterThan(0);
  expect(fs.existsSync(path.join(home.root, 'USER.md'))).toBe(true);
  // The same setup is live for a person, so the team's silence above is real.
  const { getHarnessRuntime } = await import('@/lib/harness/runtime');
  await getHarnessRuntime('claude');
  // Claude's runtime is read from auth, without a telemetry probe.
  expect(harnessCalls).toContain('claude auth');
  const { discoverExternalAgentSessions } = await import('@/lib/import/external-agents');
  const found = await discoverExternalAgentSessions();
  expect(JSON.stringify(found)).toContain(CLAUDE_SESSION);
  const { stopScheduler } = await import('@/lib/scheduler/runner');
  stopScheduler();
});

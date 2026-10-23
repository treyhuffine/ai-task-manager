import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTeamTestHome, type TeamTestHome } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import { setTeamAiEnabled, teamAiStatus, forgetTeamAiKey } from './settings';
import { saveTeamAiApiKey, hasTeamAiApiKey } from './secrets';
vi.mock('@/lib/harness/runtime', () => ({ getHarnessRuntime: async () => ({ binary: { status: 'missing' } }), resolveHarnessAuth: async () => ({ options: [] }) }));
let home: TeamTestHome;
beforeEach(async () => { vi.stubEnv('RI_MIRROR_DISABLED', '1'); home = await createTeamTestHome('ri-fresh-ai-optional-'); });
afterEach(async () => { await home.cleanup(); vi.unstubAllEnvs(); });
it('keeps tasks and notes usable with no agent or account and permits optional AI before setup', async () => {
  expect(await teamAiStatus()).toMatchObject({ state: 'off', enabled: false });
  await setTeamAiEnabled(home.owner.id, true);
  expect(await teamAiStatus()).toMatchObject({ state: 'unavailable', enabled: true });
  expect(q.listTeamChats()).toEqual([]);
  const task = q.createTask({ title: 'Unassigned work without AI' });
  const note = q.createNote({ title: 'Shared note', body: 'Ready' });
  expect(q.getTask(task.id)?.assigneeMemberId).toBeNull(); expect(q.getNote(note.id)?.body).toBe('Ready');
});
it('keeps the old encrypted key unused until its owner explicitly removes it', async () => {
  await saveTeamAiApiKey('fixture-only-secret');
  await setTeamAiEnabled(home.owner.id, true);
  expect(await teamAiStatus()).toMatchObject({ state: 'unavailable', hasApiKey: true, credentialUnused: true });
  expect(JSON.stringify(await teamAiStatus())).not.toContain('fixture-only-secret');
  expect(hasTeamAiApiKey()).toBe(true);
  await forgetTeamAiKey(home.owner.id); expect(hasTeamAiApiKey()).toBe(false);
});

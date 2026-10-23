import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { HARNESS_IDS } from '@/lib/harness/registry';
import { getHarnessRuntime, resolveHarnessAuth } from '@/lib/harness/runtime';
import { appRouter } from '@/lib/trpc/router';
import type { RequestKey } from '@/lib/auth/request-key';
import { API_KEY_ID_HEADER, API_KEY_SCOPE_HEADER, MEMBER_ID_HEADER } from '@/lib/auth/request-key';
import * as q from '@/lib/db/queries';
import { resolveHomeContext } from './context';
import { resolveHomeExecutionChoices } from './execution-choices';

vi.mock('@/lib/harness/runtime', async original => ({ ...await original<typeof import('@/lib/harness/runtime')>(), getHarnessRuntime: vi.fn(), resolveHarnessAuth: vi.fn() }));
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
let key: RequestKey;
beforeEach(async () => {
  vi.resetAllMocks(); fixture = await createTeamExecutionFixture();
  key = { apiKeyId: fixture.member.key.id, memberId: fixture.member.member.id, memberRole: 'member', scope: 'member', location: 'elsewhere', workerDeviceId: null, sessionChatId: null };
});
afterEach(async () => { await fixture.cleanup(); });
function deferredRuntime() {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(getHarnessRuntime).mockImplementation(async harness => {
    await wait;
    return { harness, binary: { status: 'supported', command: 'fixture', version: '1.0', protocolProfile: null }, capabilities: {} } as Awaited<ReturnType<typeof getHarnessRuntime>>;
  });
  vi.mocked(resolveHarnessAuth).mockImplementation(async () => {
    await wait;
    return { options: [{ present: true }] } as Awaited<ReturnType<typeof resolveHarnessAuth>>;
  });
  return release;
}

it('serves identity, Team navigation and editable content while every harness probe is stalled', async () => {
  const release = deferredRuntime();
  const request = new Request('http://fixture.test/api/trpc', { headers: { [API_KEY_ID_HEADER]: key.apiKeyId, [API_KEY_SCOPE_HEADER]: key.scope, [MEMBER_ID_HEADER]: key.memberId! } });
  const caller = appRouter.createCaller({ key, request });
  const runtime = caller.homeExecutionChoices();
  await vi.waitFor(() => expect(getHarnessRuntime).toHaveBeenCalledTimes(HARNESS_IDS.length));
  try {
    expect(await caller.homeContext()).toMatchObject({ viewer: { id: key.memberId } });
    expect(await caller.team.ai.configuration()).toEqual({ enabled: true, mainChatId: null });
    const task = await caller.tasks.create({ title: 'Work stays usable', body: '', rawInput: 'Work stays usable' });
    expect(await caller.tasks.list()).toEqual(expect.arrayContaining([expect.objectContaining({ id: task.id })]));
    expect(await caller.tasks.update({ id: task.id, patch: { title: 'Edited while AI waits' } })).toMatchObject({ title: 'Edited while AI waits' });
    expect(await caller.notes.list()).toEqual([]);
    expect(getHarnessRuntime).toHaveBeenCalledTimes(HARNESS_IDS.length);
  } finally { release(); }
  expect(await runtime).toEqual([expect.objectContaining({ available: true, audience: 'team' })]);
});

it.each(['removed member', 'revoked key', 'AI off'] as const)('rechecks %s after a slow availability probe', async change => {
  const release = deferredRuntime();
  const pending = resolveHomeExecutionChoices(key);
  const result = pending.then(data => ({ data, error: null }), error => ({ data: null, error }));
  await vi.waitFor(() => expect(getHarnessRuntime).toHaveBeenCalledTimes(HARNESS_IDS.length));
  if (change === 'removed member') q.removeMember(fixture.member.member.id);
  if (change === 'revoked key') q.revokeApiKey(key.apiKeyId, 'Fixture revocation');
  if (change === 'AI off') q.saveTeamAiSettings({ enabled: false }, fixture.owner.member.id);
  release();
  const settled = await result;
  if (change === 'AI off') expect(settled.data).toEqual([expect.objectContaining({ available: false, unavailableReason: 'Team AI is off.' })]);
  else expect(settled.error).toMatchObject({ code: 'not_allowed' });
});

it('keeps content usable when harness discovery fails, and does no probes with AI off', async () => {
  vi.mocked(getHarnessRuntime).mockRejectedValue(new Error('Fixture unavailable'));
  vi.mocked(resolveHarnessAuth).mockRejectedValue(new Error('Fixture sign-in unavailable'));
  expect(await resolveHomeExecutionChoices(key)).toEqual([expect.objectContaining({ available: false })]);
  expect(await resolveHomeContext(key)).toMatchObject({ home: { kind: 'team' } });
  vi.clearAllMocks(); q.saveTeamAiSettings({ enabled: false }, fixture.owner.member.id);
  expect(await resolveHomeExecutionChoices(key)).toEqual([expect.objectContaining({ available: false, unavailableReason: 'Team AI is off.' })]);
  expect(getHarnessRuntime).not.toHaveBeenCalled(); expect(resolveHarnessAuth).not.toHaveBeenCalled();
});

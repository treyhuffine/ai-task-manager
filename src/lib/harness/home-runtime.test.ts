import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import { HARNESS_IDS } from './registry';
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>, fakes: FakeHarness[];
beforeAll(preloadTeamRoutes);
beforeEach(async () => { fixture = await createTeamExecutionFixture(); vi.stubGlobal('fetch', serveTeam); fakes = HARNESS_IDS.map(id => installFakeHarness(id)); fakes.find(fake => fake.harness === 'codex')!.modelId = 'gpt-6.1-sol'; });
afterEach(async () => { fakes.forEach(fake => fake.restore()); await fixture.cleanup(); vi.unstubAllGlobals(); });
it('uses the ordinary installed harness catalog and sign-ins for every Team member', async () => {
  const member = await teamTrpc(fixture.member.token.plaintext);
  const catalog = await member.harness.harnessesGet.query({});
  expect(catalog.harnesses.map(row => row.id)).toEqual([...HARNESS_IDS]);
  expect(catalog.harnesses.every(row => row.runtime.binary.status === 'supported')).toBe(true);
  expect(await member.harness.authPost.mutate({ body: { harness: 'codex' } })).toMatchObject({ hasSubscription: true, binary: { installed: true } });
  expect((await member.harness.modelsGet.query({ query: { provider: 'codex' } })).models.map(model => model.id)).toContain('gpt-6.1-sol');
  expect(fakes.every(fake => fake.sessions.length === 0)).toBe(true);
});
it('keeps sign-in and model configuration owner-controlled through the same operations', async () => {
  const member = await teamTrpc(fixture.member.token.plaintext), owner = await teamTrpc(fixture.owner.token.plaintext);
  await expect(member.harness.defaultPut.mutate({ body: { harness: 'codex', model: 'gpt-6.1-sol' } })).rejects.toMatchObject({ data: { httpStatus: 403 } });
  expect(await owner.harness.defaultPut.mutate({ body: { harness: 'codex', model: 'gpt-6.1-sol' } })).toMatchObject({ harness: 'codex', model: 'gpt-6.1-sol' });
});

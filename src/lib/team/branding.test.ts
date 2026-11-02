import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamTestHome, preloadTeamRoutes, serveTeam, teamTrpc, type TeamTestHome } from '@/test/fixtures/team-home';
import { saveAttachment } from '@/lib/attachments/save';
import * as q from '@/lib/db/queries';

let fixture: TeamTestHome;
beforeAll(preloadTeamRoutes, 120_000);
beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1');
  vi.stubGlobal('fetch', serveTeam);
  fixture = await createTeamTestHome('ri-team-branding-');
});
afterEach(async () => { await fixture.cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const image = () => saveAttachment({ data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="green"/></svg>'), originalName: 'company.svg', mimeType: 'image/svg+xml' });

it('lets the owner set, replace and remove an uploaded logo while members read the same identity', async () => {
  const member = await fixture.joinAs('Luis');
  const owner = await teamTrpc(fixture.owner.token), reader = await teamTrpc(member.token);
  const first = await image();
  expect(await owner.team.setLogo.mutate({ image: first })).toEqual({ image: first });
  expect((await reader.userState.list.query({}))?.orchestratorImage).toEqual(first);
  const second = await image();
  await owner.team.setLogo.mutate({ image: second });
  expect(q.getUserState()?.orchestratorImage).toEqual(second);
  expect(q.getHome()?.name).toBe('Acme');
  await owner.team.setLogo.mutate({ image: null });
  await owner.team.setLogo.mutate({ image: null });
  expect(q.getUserState()?.orchestratorImage).toBeNull();
});

it('refuses member and revoked credentials without changing the logo', async () => {
  const member = await fixture.joinAs('Luis');
  const owner = await teamTrpc(fixture.owner.token), writer = await teamTrpc(member.token);
  const logo = await image();
  await owner.team.setLogo.mutate({ image: logo });
  await expect(writer.team.setLogo.mutate({ image: null })).rejects.toMatchObject({ data: { httpStatus: 403 } });
  q.removeMember(member.id);
  await expect(writer.team.setLogo.mutate({ image: logo })).rejects.toThrow();
  expect(q.getUserState()?.orchestratorImage).toEqual(logo);
});

it('refuses non-images, unsafe paths and image metadata without an upload', async () => {
  const owner = await teamTrpc(fixture.owner.token);
  const logo = await image();
  await owner.team.setLogo.mutate({ image: logo });
  for (const invalid of [
    { ...logo, mimeType: 'text/plain' },
    { ...logo, fileName: '../data.db' },
    { ...logo, fileName: '00000000-0000-7000-8000-000000000000.svg' },
  ]) {
    await expect(owner.team.setLogo.mutate({ image: invalid })).rejects.toMatchObject({ data: { httpStatus: 400 } });
    expect(q.getUserState()?.orchestratorImage).toEqual(logo);
  }
});

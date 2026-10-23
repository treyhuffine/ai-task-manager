import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { getProviderStatus, isLocalAvailable, pickProvider, transcribe } from './transcribe';

let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
beforeEach(async () => { vi.stubEnv('RI_MIRROR_DISABLED', '1'); fixture = await createTeamExecutionFixture(); });
afterEach(async () => { await fixture.cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('does not discover personal speech services or transcribe through host credentials for a native team grant', async () => {
  const network = vi.fn().mockRejectedValue(new Error('No host service may be probed.')); vi.stubGlobal('fetch', network);
  await expect(isLocalAvailable()).rejects.toMatchObject({ code: 'team_boundary' });
  await expect(getProviderStatus()).rejects.toMatchObject({ code: 'team_boundary' });
  await expect(pickProvider()).rejects.toMatchObject({ code: 'team_boundary' });
  await expect(transcribe(new Blob(['fixture']), 'groq/whisper-large-v3-turbo')).rejects.toMatchObject({ code: 'team_boundary' });
  expect(network).not.toHaveBeenCalled();
});

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

const mocks = vi.hoisted(() => ({ status: vi.fn(), stop: vi.fn(), outro: vi.fn() }));
vi.mock('@clack/prompts', async (original) => ({
  ...await original<typeof import('@clack/prompts')>(),
  intro: vi.fn(), outro: mocks.outro, log: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warn: vi.fn() },
}));
vi.mock('@/lib/service/client', () => ({ serviceStatus: mocks.status, stopService: mocks.stop }));

import { stopCommand } from './stop';
import { readStopped } from '@/lib/service/stopped';
import { supervisionRecord } from '@/lib/service/supervision-state';

let home: TestHome;
beforeEach(async () => {
  vi.clearAllMocks();
  home = await createTestHome({ prefix: 'ri-cli-stop-', openDb: false });
  vi.stubEnv('RI_INSTALL_ROOT', path.join(home.root, '..', `${path.basename(home.root)}-installation`));
  mocks.status.mockResolvedValue({ runId: 'running', phase: 'running', origin: 'http://localhost:4224' });
  mocks.stop.mockResolvedValue(undefined);
});
afterEach(async () => { vi.unstubAllEnvs(); await home.cleanup(); });

function supervise() {
  fs.mkdirSync(path.dirname(supervisionRecord()), { recursive: true });
  fs.writeFileSync(supervisionRecord(), '{}');
}

it('records a supervised stop before stopping, so the Home stays down after a restart', async () => {
  supervise();
  mocks.stop.mockImplementation(async () => { expect(readStopped()).not.toBeNull(); });
  await stopCommand({});
  expect(mocks.stop).toHaveBeenCalledOnce();
  expect(readStopped()?.at).toEqual(expect.any(String));
  expect(mocks.outro).toHaveBeenCalledWith('Stopped. It stays stopped, after restarts too, until you run `ri start`. Data was retained.');
});

it('stops an unsupervised service as before, without a record', async () => {
  await stopCommand({});
  expect(mocks.stop).toHaveBeenCalledOnce();
  expect(readStopped()).toBeNull();
  expect(mocks.outro).toHaveBeenCalledWith('Stopped the background service. Data was retained.');
});

it('keeps a supervised Home that is already down stopped, and says since when', async () => {
  supervise();
  mocks.status.mockResolvedValue(null);
  await stopCommand({});
  expect(readStopped()).not.toBeNull();
  expect(mocks.outro).toHaveBeenCalledWith('Not running. It stays stopped until you run `ri start`.');
  await stopCommand({});
  expect(mocks.outro).toHaveBeenLastCalledWith(expect.stringMatching(/^Already stopped at .+\. Run `ri start` to start it\.$/));
  expect(mocks.stop).not.toHaveBeenCalled();
});

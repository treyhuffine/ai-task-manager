import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { AppError } from '@ri/app-kit/contract';
import { staticFixture } from '@ri/app-kit/testing';
import { exportPackage } from '@ri/app-kit/build';
import { LocalAppsService } from './service';

vi.mock('@/lib/service/maintenance', () => ({ beginActivity: () => () => {} }));
let root: string, service: LocalAppsService;
afterEach(async () => {
  await service?.dispose();
  if (root) await fs.rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('retries a failed preview without installing it or changing its records', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ri-app-retry-'));
  vi.stubEnv('RI_ROOT', path.join(root, 'home'));
  vi.stubEnv('RI_LOCAL_APPS', '1');
  const artifact = staticFixture(path.join(root, 'package'));
  const archive = path.join(root, 'app.tar.gz');
  await exportPackage(artifact, archive);
  service = new LocalAppsService();
  await service.initialize();
  const draft = await service.import(archive);
  const installed = {
    ...artifact, instanceId: draft.id, dataDir: path.join(root, 'records'),
    cacheDir: path.join(root, 'cache'), logsDir: path.join(root, 'logs'),
  };
  const start = vi.spyOn(service.driver, 'start').mockRejectedValue(new AppError('app_failed', 'Fixture startup failure'));
  for (let attempt = 0; attempt < 3; attempt++) await expect(service.engine.start(installed)).rejects.toThrow('Fixture startup failure');
  await expect(service.engine.start(installed)).rejects.toThrow('failed to start repeatedly');
  const before = service.store.read();
  expect(() => service.retry(draft.id)).toThrow('no longer installed');
  expect(() => service.retry(crypto.randomUUID(), true)).toThrow('no longer exists');
  service.retry(draft.id, true);
  expect(service.store.read()).toEqual(before);
  await expect(service.engine.start(installed)).rejects.toThrow('Fixture startup failure');
  expect(start).toHaveBeenCalledTimes(4);
});

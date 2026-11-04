/**
 * The low-disk warning, through the real database and notify() pipeline with a
 * fake adapter. Only the free space is faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { warnIfDiskLow } from './disk-warning';
import type { NotificationChannelAdapter } from '@/lib/notifications/types';

const TEST_DB = path.join(os.tmpdir(), `ri-disk-warning-test-${process.pid}.db`);
const GIB = 1024 ** 3;

function removeDb() {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(TEST_DB + suffix, { force: true });
}

function freeSpace(bytes: number) {
  vi.spyOn(fs, 'statfsSync').mockReturnValue({ bavail: bytes / 4096, bsize: 4096 } as ReturnType<typeof fs.statfsSync>);
}

async function setup() {
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  getDb();
  const queries = await import('@/lib/db/queries');
  const sent: Array<{ channelId: string; title: string; body: string }> = [];
  const adapter: NotificationChannelAdapter = {
    kind: 'integration',
    providerId: 'test',
    async deliver(channel, rendered) {
      sent.push({ channelId: channel.id, title: rendered.title, body: rendered.body });
      return { providerMessageId: 'm1' };
    },
  };
  return { queries, sent, deps: { resolveAdapter: () => adapter } };
}

beforeEach(() => {
  removeDb();
  process.env.RI_DB_PATH = TEST_DB;
});
afterEach(() => {
  vi.restoreAllMocks();
  removeDb();
});

const NOV_3 = new Date('2026-11-03T18:00:00Z');

describe('warnIfDiskLow', () => {
  it('says nothing with 10 GiB or more free', async () => {
    const { queries, sent, deps } = await setup();
    queries.createNotificationChannel({ userId: 'local', kind: 'integration', providerId: 'test', config: {}, events: [] });
    freeSpace(10 * GIB);
    await warnIfDiskLow(NOV_3, deps);
    expect(sent).toHaveLength(0);
  });

  it('warns every enabled channel below 10 GiB, even one set up before the warning existed', async () => {
    const { queries, sent, deps } = await setup();
    // The events a channel saved when it was made, with no mention of this one.
    const channel = queries.createNotificationChannel({ userId: 'local', kind: 'integration', providerId: 'test', config: {}, events: ['execution.finished'] });
    queries.createNotificationChannel({ userId: 'local', kind: 'integration', providerId: 'test', config: {}, events: [], enabled: false });
    freeSpace(8.25 * GIB);
    await warnIfDiskLow(NOV_3, deps);
    expect(sent).toEqual([{
      channelId: channel.id,
      title: 'Disk almost full',
      body: '8.3 GiB left on this computer. Schedules, chats and saves can start failing when it runs out, so free up some space.',
    }]);
  });

  it('warns once a day however often it checks, and again the next day', async () => {
    const { queries, sent, deps } = await setup();
    queries.createNotificationChannel({ userId: 'local', kind: 'integration', providerId: 'test', config: {}, events: [] });
    freeSpace(GIB);
    await warnIfDiskLow(NOV_3, deps);
    await warnIfDiskLow(new Date(NOV_3.getTime() + 5 * 60_000), deps);
    expect(sent).toHaveLength(1);
    await warnIfDiskLow(new Date(NOV_3.getTime() + 24 * 60 * 60_000), deps);
    expect(sent).toHaveLength(2);
  });

  it('reads the real free space of the home', async () => {
    await setup();
    const statfs = vi.spyOn(fs, 'statfsSync');
    await warnIfDiskLow(NOV_3, { resolveAdapter: () => undefined });
    expect(statfs).toHaveBeenCalledWith(process.env.RI_ROOT);
    expect(Number(statfs.mock.results[0]?.value.bavail)).toBeGreaterThan(0);
  });
});

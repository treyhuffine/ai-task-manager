import { expect, it } from 'vitest';
import type { UpdateRecord } from './update';
import { updateNotice, wantsUpdateNotice } from './update-notice';

const release = { version: '0.4.2', runtime: { id: 'a'.repeat(64) } } as UpdateRecord['release'];
const record = (change: Partial<UpdateRecord>): UpdateRecord => ({ format: 1, phase: 'idle', changedAt: '', ...change });

it('says once that a Home moved', () => {
  const update = record({ phase: 'committed', committedAt: '2026-11-07T00:00:00Z', release });
  const first = updateNotice(update, '~/ri', null);
  expect(first?.line).toBe('Updated ~/ri to 0.4.2');
  expect(updateNotice(update, '~/ri', first!.mark)).toBeNull();
});

it('says once that an update is waiting, and for what', () => {
  const update = record({ phase: 'waiting', reason: '2 chats', release });
  const first = updateNotice(update, '~/ri', null);
  expect(first?.line).toBe('Ri 0.4.2 is ready. Waiting for 2 chats to finish. To update now: ri update');
  expect(updateNotice(update, '~/ri', first!.mark)).toBeNull();
  expect(updateNotice(record({ phase: 'waiting', reason: 'a quiet moment', release }), '~/ri', first!.mark)).toBeNull();
});

it('stays quiet otherwise', () => {
  expect(updateNotice(record({ phase: 'idle' }), '~/ri', null)).toBeNull();
  expect(updateNotice(record({ phase: 'failed', release }), '~/ri', null)).toBeNull();
});

it('only talks to a person, and not over a command about updates or an agent\'s output', () => {
  expect(wantsUpdateNotice('tasks', true)).toBe(true);
  expect(wantsUpdateNotice('tasks', false)).toBe(false);
  for (const command of ['update', 'status', 'agent', 'start']) expect(wantsUpdateNotice(command, true)).toBe(false);
});

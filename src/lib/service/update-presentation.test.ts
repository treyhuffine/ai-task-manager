import { expect, it } from 'vitest';
import type { Release } from './release-trust';
import type { UpdateRecord } from './update';
import { maintenanceWindowText, railUpdateNotice, updateProgress, updateStatusText } from './update-presentation';

const record: UpdateRecord = { format: 1, phase: 'downloading', changedAt: '', release: { runtime: { size: 4 * 1024 ** 2 } } as Release };
it('distinguishes byte transfer from verification after the last byte', () => {
  expect(updateStatusText({ ...record, bytes: 2 * 1024 ** 2 })).toBe('Downloading update…');
  expect(updateProgress({ ...record, bytes: 2 * 1024 ** 2 })).toEqual({ percent: 50, text: '2.0 of 4.0 MiB downloaded' });
  expect(updateStatusText({ ...record, bytes: 4 * 1024 ** 2 })).toMatch(/Verifying/);
  expect(updateProgress({ ...record, bytes: 10 * 1024 ** 2 })?.percent).toBe(100);
});
it('retains the waiting reason and identifies maintenance phases while busy', () => {
  expect(updateStatusText({ ...record, phase: 'waiting', reason: '2 chats', busy: true })).toBe('Waiting for 2 chats to finish');
  expect(updateStatusText({ ...record, phase: 'waiting', reason: 'a quiet moment' })).toBe('Waiting for a quiet moment');
  expect(updateStatusText({ ...record, phase: 'waiting', reason: 'Waiting for the maintenance window (UTC)' })).toBe('Waiting for the maintenance window (UTC)');
  expect(updateStatusText({ ...record, phase: 'waiting', headsUpAt: new Date().toISOString() })).toBe('Ri will update in 1 minute');
  expect(updateStatusText({ ...record, phase: 'waiting', heldUntil: new Date(Date.now() + 60_000).toISOString() })).toMatch(/^You asked to update later/);
  expect(updateStatusText({ ...record, phase: 'checkpointing', busy: true })).toBe('Backing up your data…');
  expect(updateStatusText({ ...record, phase: 'validating', busy: true })).toMatch(/migrations/);
  expect(updateProgress({ ...record, phase: 'ready' })).toBeNull();
});
it('shows windows that cross midnight in the selected zone', () => {
  expect(maintenanceWindowText({ hour: 23, durationHours: 3, timeZone: 'America/Denver' })).toBe('between 23:00 and 02:00 (America/Denver)');
});
it('puts a waiting update in the rail only for people who can act on it, and only while it waits', () => {
  const waiting = { ...record, phase: 'waiting' as const, reason: '8 chats, 2 background tasks' };
  expect(railUpdateNotice({ canUseUpdates: true, update: waiting })).toBe('Waiting for 8 chats, 2 background tasks to finish');
  // Someone who can't act on updates sees the refresh notice afterwards instead.
  expect(railUpdateNotice({ canUseUpdates: false, update: waiting })).toBeNull();
  for (const phase of ['idle', 'available', 'downloading', 'ready', 'draining', 'checkpointing', 'validating', 'committed', 'failed'] as const) {
    expect(railUpdateNotice({ canUseUpdates: true, update: { ...waiting, phase } })).toBeNull();
  }
  expect(railUpdateNotice({ canUseUpdates: true })).toBeNull();
  expect(railUpdateNotice(undefined)).toBeNull();
  expect(railUpdateNotice({ canUseUpdates: true, update: { ...waiting, headsUpAt: new Date().toISOString() } })).toBe('Ri will update in 1 minute');
});

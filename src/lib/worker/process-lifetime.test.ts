import { expect, it } from 'vitest';
import { linuxProcessBirth, sameProcessLifetime, type ProcessIdentity } from './leftovers';

const recorded: ProcessIdentity = { pid: 40, ppid: 20, started: 'Thu Oct 22 12:00:00 2026', command: 'launcher', birthId: 'boot:123456789' };
it('recognizes exec and adoption by an arbitrary Linux subreaper using kernel birth identity', () => {
  expect(sameProcessLifetime({ ...recorded, ppid: 900, command: 'actual harness' }, recorded)).toBe(true);
  expect(sameProcessLifetime({ ...recorded, started: 'after a wall-clock correction', ppid: 900 }, recorded)).toBe(true);
  expect(sameProcessLifetime({ ...recorded, birthId: 'boot:123456790' }, recorded)).toBe(false);
  expect(sameProcessLifetime({ ...recorded, birthId: 'other-boot:123456789' }, recorded)).toBe(false);
  expect(sameProcessLifetime({ ...recorded, pid: 41 }, recorded)).toBe(false);
  expect(sameProcessLifetime(null, recorded)).toBe(false);
});
it('keeps legacy or unreadable birth identities unconfirmed after an unexplained parent change', () => {
  const legacy = { ...recorded, birthId: undefined };
  expect(sameProcessLifetime({ ...recorded, ppid: 900 }, legacy)).toBeNull();
  expect(sameProcessLifetime({ ...recorded, birthId: undefined }, recorded)).toBeNull();
  expect(sameProcessLifetime({ ...legacy, command: 'exec harness' }, legacy)).toBe(true);
  expect(sameProcessLifetime({ ...legacy, ppid: 1 }, legacy)).toBe(true);
  expect(sameProcessLifetime({ ...legacy, started: 'different legacy birth' }, legacy)).toBe(false);
});
it('parses Linux start ticks without losing precision or misreading parentheses in comm', () => {
  const stat = `40 (a process ) with (brackets)) S ${Array(18).fill('0').join(' ')} 12345678901234567890 0`;
  expect(linuxProcessBirth(stat, 'kernel-boot\n')).toBe('kernel-boot:12345678901234567890');
  for (const invalid of ['', '40 (truncated) S 1 2', stat.replace('12345678901234567890', 'invalid')]) expect(linuxProcessBirth(invalid, 'boot')).toBeUndefined();
  expect(linuxProcessBirth(stat, '')).toBeUndefined();
});

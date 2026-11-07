import { expect, it } from 'vitest';
import { CURRENT_COMPATIBILITY, type PeerRelease, type RuntimeCompatibility } from '@/lib/releases/compatibility';
import { compareVersions, followTarget, type PublishedVersion } from './follow-home';

const peer = (version: string, compatibility: RuntimeCompatibility = CURRENT_COMPATIBILITY, source: 'packaged' | 'source' = 'packaged'): PeerRelease => ({ release: { version, build: `build-${version}`, source }, compatibility });
const protocols = (...workerProtocols: number[]): RuntimeCompatibility => ({ ...CURRENT_COMPATIBILITY, workerProtocols });
const entry = (version: string, sequence: number, compatibility: RuntimeCompatibility): PublishedVersion => ({ version, sequence, compatibility });

it('compares versions the way releases are numbered', () => {
  expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0);
  expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
  expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0);
});

it('follows its Home when the Home moves ahead', () => {
  expect(followTarget({ own: peer('0.1.0'), home: { peer: peer('0.2.0') } })).toEqual({ version: '0.2.0', why: 'home' });
});

it('stays put when it matches its Home, or is ahead of it', () => {
  expect(followTarget({ own: peer('0.2.0'), home: { peer: peer('0.2.0') } })).toBeNull();
  expect(followTarget({ own: peer('0.3.0'), home: { peer: peer('0.2.0') } })).toBeNull();
});

it('keeps its own version when the Home was built from a checkout', () => {
  expect(followTarget({ own: peer('0.1.0'), home: { peer: peer('0.2.0', CURRENT_COMPATIBILITY, 'source') } })).toBeNull();
});

it('stays put before it has heard from its Home', () => {
  expect(followTarget({ own: peer('0.1.0'), home: {} })).toBeNull();
});

it('moves first to a bridge when the Home\'s next release could not talk to it', () => {
  const home = { peer: peer('0.2.0', protocols(4)), next: { version: '0.3.0', compatibility: protocols(5) } };
  const index = [entry('0.3.0', 3, protocols(5)), entry('0.2.5', 2, protocols(4, 5)), entry('0.2.0', 1, protocols(4))];
  expect(followTarget({ own: peer('0.2.0', protocols(4)), home, index })).toEqual({ version: '0.2.5', why: 'bridge' });
});

it('does not move when the Home\'s next release can already talk to it', () => {
  const home = { peer: peer('0.2.0', protocols(4)), next: { version: '0.3.0', compatibility: protocols(4, 5) } };
  expect(followTarget({ own: peer('0.2.0', protocols(4)), home, index: [] })).toBeNull();
});

it('waits when no published release can talk to both', () => {
  const home = { peer: peer('0.2.0', protocols(4)), next: { version: '0.3.0', compatibility: protocols(5) } };
  expect(followTarget({ own: peer('0.2.0', protocols(4)), home, index: [entry('0.3.0', 3, protocols(5))] })).toBeNull();
});

it('never bridges backwards', () => {
  const home = { peer: peer('0.2.0', protocols(4)), next: { version: '0.3.0', compatibility: protocols(5) } };
  expect(followTarget({ own: peer('0.2.5', protocols(4)), home, index: [entry('0.2.1', 2, protocols(4, 5))] })).toBeNull();
});

it('stays put for a Home built from a checkout, which is on no feed', () => {
  const own = peer('0.1.0');
  const home = { peer: peer('0.2.0') };
  expect(followTarget({ own, home })).toEqual({ version: '0.2.0', why: 'home' });
  expect(followTarget({ own, home: { ...home, published: true } })).toEqual({ version: '0.2.0', why: 'home' });
  expect(followTarget({ own, home: { ...home, published: false } })).toBeNull();
});


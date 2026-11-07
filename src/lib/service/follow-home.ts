/**
 * Which release a connected computer should run (docs/always-on-spec.md 7.7). It
 * follows its Home, and moves first to a bridge when the Home's next release
 * couldn't talk to it, since waiting for the Home there would deadlock. A Home
 * built from a checkout isn't published, so a computer connected to one stays put,
 * and the compatibility contract decides whether the two still work together.
 */
import { negotiateWorker, type PeerRelease, type RuntimeCompatibility } from '@/lib/releases/compatibility';
import { compareVersions } from './version-order';

export { compareVersions };

export interface PublishedVersion { version: string; sequence: number; compatibility: RuntimeCompatibility }
/** `published` is false for a Home built from a checkout, which isn't on any feed. */
export interface HomeRelease { peer?: PeerRelease; next?: { version: string; compatibility?: RuntimeCompatibility }; published?: boolean }
export type FollowTarget = { version: string; why: 'home' | 'bridge' };

const compatible = (home: RuntimeCompatibility, worker: RuntimeCompatibility) => negotiateWorker(home, worker).compatible;

/** `index` is only read when a bridge is needed, newest first. */
export function followTarget(input: { own: PeerRelease; home: HomeRelease; index?: PublishedVersion[] }): FollowTarget | null {
  const { own, home, index = [] } = input;
  const current = home.peer;
  if (!current || current.release.source !== 'packaged' || home.published === false) return null;
  const next = home.next;
  if (next?.compatibility && !compatible(next.compatibility, own.compatibility)) {
    const bridge = index.find(entry => compatible(next.compatibility!, entry.compatibility) && compatible(current.compatibility, entry.compatibility));
    if (bridge && compareVersions(bridge.version, own.release.version) > 0) return { version: bridge.version, why: 'bridge' };
  }
  // Ahead of its Home is fine while the two can talk. Only the Home can fix the
  // rest, and a computer never moves backwards.
  if (compareVersions(current.release.version, own.release.version) > 0) return { version: current.release.version, why: 'home' };
  return null;
}

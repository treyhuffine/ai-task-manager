/**
 * Whether this screen can reach its Ri home (docs/homes-spec.md §3.5).
 *
 * The API client reports what it sees: any HTTP response means the home is
 * reachable, whatever its status. A network failure is only a suspicion
 * until `/api/health` (public, tiny) also fails, so one dropped request
 * doesn't flash a warning. Aborted requests say nothing about reachability
 * and are ignored.
 */

export interface Connectivity {
  reachable: boolean;
  /** When it stopped being reachable, for "last reached" wording. */
  since: number | null;
}

let state: Connectivity = { reachable: true, since: null };
const listeners = new Set<() => void>();
let probing: Promise<boolean> | null = null;

function set(next: Connectivity) {
  if (next.reachable === state.reachable) return;
  state = next;
  for (const fn of listeners) fn();
}

export function getConnectivity(): Connectivity {
  return state;
}

export function subscribeConnectivity(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function reportReachable(): void {
  set({ reachable: true, since: null });
}

/** A fetch rejected without a response: offline, asleep, or unreachable. Not an abort. */
export function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError;
}

/** Ask the home directly. Resolves true when it answers. Concurrent calls share one probe. */
export function probeHome(timeoutMs = 5000): Promise<boolean> {
  if (!probing) {
    probing = fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        probing = null;
      });
  }
  return probing;
}

export async function reportNetworkFailure(): Promise<void> {
  if (!state.reachable) return;
  const ok = await probeHome();
  if (ok) reportReachable();
  else set({ reachable: false, since: Date.now() });
}

/** Tests only. */
export function _resetConnectivity(): void {
  state = { reachable: true, since: null };
  probing = null;
}

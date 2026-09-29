/**
 * Whether this screen can reach its Ri home (docs/homes-spec.md §3.5).
 *
 * The API client reports what it sees. A network failure, or a gateway
 * error (502, 503, 504, or a Cloudflare 52x), is only a suspicion: when the
 * home is asleep behind a tunnel, the tunnel still answers, with an error.
 * The suspicion is confirmed only when `/api/health` also fails to answer as
 * Ri, so one bad request doesn't flash a warning and an app error from a
 * running home (its own 503, say) doesn't either. Any other response means
 * the home answered. Aborted requests say nothing and are ignored.
 */

import { APP_SHORT_ID } from '@/constants/app';

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

/** Statuses a proxy or tunnel returns when the server behind it doesn't answer. */
export function isGatewayFailure(status: number): boolean {
  return status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 530);
}

/**
 * Ask the home directly. Resolves true only when Ri itself answers, not a
 * tunnel's error page. Concurrent calls share one probe.
 */
export function probeHome(timeoutMs = 5000): Promise<boolean> {
  if (!probing) {
    probing = fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
      .then(async (res) => {
        if (!res.ok) return false;
        const body = (await res.json().catch(() => null)) as { app?: string } | null;
        return body?.app === APP_SHORT_ID;
      })
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

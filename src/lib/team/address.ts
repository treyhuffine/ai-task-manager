/** Verify that an invitation address reaches this team before advertising it. */
import { createTeamAddressProbe, deleteTeamAddressProbe, getHome } from '@/lib/db/queries';
import { readLimitedRequestBody } from '@/lib/webhooks/read-limited-body';
import { baseUrlSnapshot } from '@/lib/auth/base-url-snapshot';

export function isLoopbackTeamAddress(address: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(address).hostname);
}

export function normalizeTeamAddress(raw: string): string {
  const value = raw.trim();
  const url = new URL(value.includes('://') ? value : `https://${value}`);
  const developmentLoopback = process.env.NODE_ENV !== 'production' && isLoopbackTeamAddress(url.origin);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && developmentLoopback)) throw new Error('Use an HTTPS address for the team.');
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Enter the team address without a path, password, or link fragment.');
  return url.origin;
}

export async function verifyTeamAddress(raw: string): Promise<string> {
  const address = normalizeTeamAddress(raw);
  const probe = createTeamAddressProbe();
  try {
    // This secret is revoked before it leaves this process. It grants no
    // sign-in or write authority. A matching unpredictable grant id proves
    // the response came from this database, not just another Ri server.
    const response = await fetch(`${address}/api/team/public/preview`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5_000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'invite', secret: probe.secret }),
    });
    if (!response.ok) throw new Error('Could not reach this team at that address.');
    const result = JSON.parse(new TextDecoder().decode(await readLimitedRequestBody(response, 16_384)));
    if (result.grantId !== probe.id || result.team?.id !== getHome()?.id || result.state !== 'revoked') throw new Error('That address does not reach this team.');
    return address;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('That address')) throw error;
    throw new Error('Could not verify this team at that address. Check the address and connection, then try again.');
  } finally {
    deleteTeamAddressProbe(probe.id);
  }
}

/** Every new link rechecks a configured remote address, including old config. */
export async function teamLinkAddress(origin: string | null = null): Promise<{ base: string; reachable: boolean }> {
  const snapshot = baseUrlSnapshot();
  let base = snapshot.local;
  if (origin) {
    try { base = normalizeTeamAddress(origin); } catch { /* Keep the local fallback. */ }
  }
  if (snapshot.tunnel) {
    try {
      base = await verifyTeamAddress(snapshot.tunnel);
      return { base, reachable: !isLoopbackTeamAddress(base) };
    } catch { /* Offer a local link with the reachability notice. */ }
  }
  return { base, reachable: false };
}

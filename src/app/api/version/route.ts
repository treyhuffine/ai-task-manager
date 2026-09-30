/** Authenticated discovery remains readable by stale viewers so they can
 * save/retain their drafts and choose a safe refresh. No installation rights. */
import { runtimePeerRelease } from '@/lib/releases/runtime-identity';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET() {
  const peer = runtimePeerRelease();
  return Response.json({ release: peer.release, apiProtocols: peer.compatibility.apiProtocols }, { headers: { 'Cache-Control': 'no-store' } });
}

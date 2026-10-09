/** GET: the hosted team as its host sees it: its name, whether it has an owner, its address. Host's own key only. */
import { getRequestKey } from '@/lib/auth/request-key';
import { baseUrlSnapshot } from '@/lib/auth/base-url-snapshot';
import { teamHasOwner } from '@/lib/db/queries';
import { noStore, teamRoute } from '@/lib/team/http';
import { teamSummary } from '@/lib/team/summary';

export const runtime = 'nodejs';

export function GET(request: Request) {
  return teamRoute(() => {
    if (getRequestKey(request.headers)?.scope !== 'host') return Response.json({ error: 'host_only' }, { status: 403 });
    const snapshot = baseUrlSnapshot();
    return Response.json(
      { team: teamSummary(), hasOwner: teamHasOwner(), address: snapshot.tunnel, local: snapshot.local },
      { headers: noStore },
    );
  });
}

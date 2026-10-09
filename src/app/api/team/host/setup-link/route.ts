/** POST: a single-use setup link for a team provisioned on a server. Host's own key only. */
import { getRequestKey } from '@/lib/auth/request-key';
import { createSetupLink } from '@/lib/team/admission';
import { noStore, teamRoute } from '@/lib/team/http';

export const runtime = 'nodejs';

export function POST(request: Request) {
  return teamRoute(async () => {
    if (getRequestKey(request.headers)?.scope !== 'host') return Response.json({ error: 'host_only' }, { status: 403 });
    return Response.json(await createSetupLink(), { headers: noStore });
  });
}

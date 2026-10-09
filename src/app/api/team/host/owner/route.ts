/**
 * POST { creationId, ownerName, teamName?, device? }: the team's first owner,
 * for the trusted local creation flow on the computer hosting the team
 * (the desktop's Create a team, `ri team create`). Host's own key only, and
 * retry-safe by creation id: the same creation signs the same owner in again.
 */
import { getRequestKey } from '@/lib/auth/request-key';
import { createOwner, ownerInput } from '@/lib/team/admission';
import { noStore, readInput, teamRoute } from '@/lib/team/http';

export const runtime = 'nodejs';

export function POST(request: Request) {
  return teamRoute(async () => {
    if (getRequestKey(request.headers)?.scope !== 'host') return Response.json({ error: 'host_only' }, { status: 403 });
    const input = await readInput(request, ownerInput);
    if (input instanceof Response) return input;
    return Response.json(createOwner(input, request.headers.get('user-agent')), { headers: noStore });
  });
}

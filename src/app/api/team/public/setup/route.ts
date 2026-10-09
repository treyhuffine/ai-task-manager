/**
 * POST { secret, teamName, ownerName, device? }: finish a team its operator
 * provisioned on a server. Only with the operator's single-use setup link,
 * and only while the team has no owner: a stranger at the address can't
 * claim it.
 */
import { finishSetup, setupInput } from '@/lib/team/admission';
import { noStore, readInput, teamRoute } from '@/lib/team/http';

export const runtime = 'nodejs';

export function POST(request: Request) {
  return teamRoute(async () => {
    const input = await readInput(request, setupInput);
    if (input instanceof Response) return input;
    return Response.json(finishSetup(input, request.headers.get('user-agent')), { headers: noStore });
  });
}

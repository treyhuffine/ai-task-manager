/** POST { secret, name, device? }: join with an invitation. Returns this client's member key once. */
import { join, joinInput } from '@/lib/team/admission';
import { noStore, readInput, teamRoute } from '@/lib/team/http';

export const runtime = 'nodejs';

export function POST(request: Request) {
  return teamRoute(async () => {
    const input = await readInput(request, joinInput);
    if (input instanceof Response) return input;
    return Response.json(join(input, request.headers.get('user-agent')), { headers: noStore });
  });
}

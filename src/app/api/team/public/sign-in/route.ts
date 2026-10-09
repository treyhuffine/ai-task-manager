/** POST { secret, device? }: sign an existing member in on this client with a sign-in link. */
import { signIn, signInInput } from '@/lib/team/admission';
import { noStore, readInput, teamRoute } from '@/lib/team/http';

export const runtime = 'nodejs';

export function POST(request: Request) {
  return teamRoute(async () => {
    const input = await readInput(request, signInInput);
    if (input instanceof Response) return input;
    return Response.json(signIn(input, request.headers.get('user-agent')), { headers: noStore });
  });
}

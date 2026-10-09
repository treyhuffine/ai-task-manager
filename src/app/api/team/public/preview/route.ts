/** POST { secret, kind }: what an invitation, sign-in or setup link opens, without using it. */
import { previewGrant, previewInput } from '@/lib/team/admission';
import { noStore, readInput, teamRoute } from '@/lib/team/http';

export const runtime = 'nodejs';

export function POST(request: Request) {
  return teamRoute(async () => {
    const input = await readInput(request, previewInput);
    if (input instanceof Response) return input;
    return Response.json(previewGrant(input), { headers: noStore });
  });
}

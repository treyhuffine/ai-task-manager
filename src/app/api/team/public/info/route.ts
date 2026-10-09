/** GET: what a bare team address says without a grant or a key (src/lib/team/admission.ts). */
import { publicInfo } from '@/lib/team/admission';
import { noStore, teamRoute } from '@/lib/team/http';

export const runtime = 'nodejs';

export function GET() {
  return teamRoute(() => Response.json(publicInfo(), { headers: noStore }));
}

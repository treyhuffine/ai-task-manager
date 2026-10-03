import { desktopEnabled, desktopOAuth } from '@/lib/connectors/desktop-oauth';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z } from 'zod/v4';
export const POSTInput = z.object({ body: z.object({ id: z.string() }).strict() }).strict();
export async function POST(input: z.infer<typeof POSTInput>, _context: OperationContext) {
  if (!desktopEnabled()) return reply({ error: 'Not found' }, { status: 404 });
  return reply({ ok: desktopOAuth().cancel(input.body.id) });
}

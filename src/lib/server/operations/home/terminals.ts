import { reply, type OperationContext } from '@/lib/server/operation';
import { createTerminalResult, listTerminalsResult, terminalDimensions } from '@/lib/terminal/operations';
import { homeTerminalPlace } from '@/lib/terminal/place';
import { z } from 'zod/v4';

/**
 * Home's own terminals (Home, More, Terminal): shells on the box the home
 * runs on, starting in its home folder, whichever device is viewing. Owned
 * by the home, apart from every execution's and agent's shells. Same shapes
 * as the session and agent terminals.
 */

export async function GET(_input: z.infer<typeof GETInput>, _context: OperationContext) {
  try {
    return await listTerminalsResult(homeTerminalPlace());
  } catch (err) {
    console.error('[GET /api/home/terminals]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export async function POST(input: z.infer<typeof POSTInput>, _context: OperationContext) {
  try {
    return await createTerminalResult(input.body, homeTerminalPlace(), '[POST /api/home/terminals]');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/home/terminals]', err);
    return reply({ error: message }, { status: 500 });
  }
}

export const GETInput = z.object({}).strict().default({});
export const POSTInput = z.object({ body: terminalDimensions.default({}) }).strict();

import { reply, type OperationContext } from '@/lib/server/operation';
import { terminalResize, terminalResizeResult } from '@/lib/terminal/operations';
import { homeTerminalPlace } from '@/lib/terminal/place';
import { z } from 'zod/v4';

export async function POST(input: z.infer<typeof POSTInput>, _context: OperationContext) {
  try {
    return await terminalResizeResult(input.body, homeTerminalPlace(), input.params.terminalId);
  } catch (err) {
    console.error('[POST /api/home/terminals/:terminalId/resize]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = z.object({ params: z.object({ terminalId: z.string().min(1) }).strict(), body: terminalResize }).strict();

import type { OperationContext } from '@/lib/server/operation';
import { deleteTerminalResult, getTerminalResult } from '@/lib/terminal/operations';
import { homeTerminalPlace } from '@/lib/terminal/place';
import { z } from 'zod/v4';
export const GETInput = z.object({ params: z.object({ terminalId: z.string().min(1) }).strict() }).strict();
export const DELETEInput = GETInput;
export async function GET(input: z.infer<typeof GETInput>, _context: OperationContext) { return getTerminalResult(homeTerminalPlace(), input.params.terminalId); }
export async function DELETE(input: z.infer<typeof DELETEInput>, _context: OperationContext) { return deleteTerminalResult(homeTerminalPlace(), input.params.terminalId); }

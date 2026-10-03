import { reply, type OperationContext } from '@/lib/server/operation';
import { getProviderStatus } from '@/lib/stt/transcribe';
import { z } from 'zod/v4';
export const GETInput = z.object({}).strict().default({});
export async function GET(_input: z.infer<typeof GETInput>, _context: OperationContext) {
  return reply({ providers: await getProviderStatus() });
}

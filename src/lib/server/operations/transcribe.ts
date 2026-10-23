import { assertPersonalCapability, isTeamBoundaryError } from '@/lib/home/authority';
import { reply, type OperationContext } from '@/lib/server/operation';
import { getProviderStatus } from '@/lib/stt/transcribe';
import { z } from 'zod/v4';
export const GETInput = z.object({}).strict().default({});
export async function GET(_input: z.infer<typeof GETInput>, _context: OperationContext) {
  try {
    assertPersonalCapability('Speech service discovery');
    return reply({ providers: await getProviderStatus() });
  } catch (error) {
    if (isTeamBoundaryError(error)) return reply({ error: 'Team voice uses browser speech recognition.', code: error.code }, { status: 403 });
    throw error;
  }
}

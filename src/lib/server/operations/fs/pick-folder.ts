import { pickFolder } from '@/lib/fs/native-picker';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Spawn a native folder dialog. Blocks until the user picks or cancels —
 * fine for a local-first desktop app, never long-running enough to need
 * special async plumbing.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const body: { prompt?: string } = rpcInput.body;
    const result = await pickFolder(body.prompt);

    if ('path' in result) {
      return reply({ kind: 'picked' as const, path: result.path });
    }
    if ('cancelled' in result) {
      return reply({ kind: 'cancelled' as const });
    }
    return reply({ kind: 'unsupported' as const, reason: result.reason });
  } catch (err) {
    console.error('[POST /api/fs/pick-folder]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ "prompt": rpcZ.string().optional() }).strict().default({}) }).strict();

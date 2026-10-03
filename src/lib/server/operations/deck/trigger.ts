import { getMorningDeckConfig, setMorningDeckConfig } from '@/lib/deck/trigger';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/** Current morning-refresh cron config (enabled / time / timezone). */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    return reply(getMorningDeckConfig());
  } catch (err) {
    console.error('[GET /api/deck/trigger]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

/** Enable/disable or retime the morning refresh. Body: { enabled?, time? }. */
export async function PUT(rpcInput: rpcZ.infer<typeof PUTInput>, _request: OperationContext) {
  try {
    const body = rpcInput.body;
    const cfg = setMorningDeckConfig({
      enabled: typeof body?.enabled === 'boolean' ? body.enabled : undefined,
      time: typeof body?.time === 'string' ? body.time : undefined,
    });
    return reply(cfg);
  } catch (err) {
    console.error('[PUT /api/deck/trigger]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({}).strict().default({});
export const PUTInput = rpcZ.object({ body: rpcZ.object({ "enabled": rpcZ.boolean().optional(), "time": rpcZ.string().optional() }).strict().default({}) }).strict();

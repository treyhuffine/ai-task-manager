import { reply, type OperationContext } from '@/lib/server/operation';
import { RunOnError, runOnFor, setDefaultDevice } from '@/lib/setups/run-on';
import { z as rpcZ } from 'zod/v4';

/**
 * Where an agent's new executions can run, and where they run by default
 * (docs/homes-spec.md §3.3, P3.1): the launcher's Run on control.
 */
export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  const runOn = runOnFor(id);
  if (!runOn) return reply({ error: 'not_found' }, { status: 404 });
  return reply(runOn);
}

/** "Make this the default": save the agent's default device, or clear it with null. */
export async function PUT(rpcInput: rpcZ.infer<typeof PUTInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  const body = (rpcInput.body) as { defaultDeviceId?: unknown };
  const deviceId = body.defaultDeviceId;
  if (deviceId !== null && typeof deviceId !== 'string') {
    return reply({ error: 'defaultDeviceId must be a device id, or null' }, { status: 400 });
  }
  try {
    return reply(setDefaultDevice(id, deviceId));
  } catch (err) {
    if (err instanceof RunOnError) return reply({ error: err.message }, { status: 400 });
    throw err;
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
export const PUTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "defaultDeviceId": rpcZ.string().nullable().optional() }).strict().default({}) }).strict();

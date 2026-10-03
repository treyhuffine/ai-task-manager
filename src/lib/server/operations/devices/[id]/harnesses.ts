import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * The harnesses a device can run (docs/homes-build.md, P2.2). By default
 * the last report its worker sent. With `?fresh=1` the home asks the worker
 * now, over its stream. For the home's own device it looks here.
 */

import { getDevice, getHome } from '@/lib/db/queries';
import { describeHarnesses } from '@/lib/worker/harnesses';
import { requestWorker, WorkerRequestError, WorkerUnavailableError } from '@/lib/workers/hub';

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  const device = getDevice(id);
  if (!device || device.status !== 'active') return reply({ error: 'not_found' }, { status: 404 });
  const fresh = searchParams(rpcInput.query).get('fresh') === '1';

  if (device.id === getHome()?.hostDeviceId) {
    return reply({ device: { id: device.id, name: device.name }, source: 'home', harnesses: await describeHarnesses({ refresh: fresh }) });
  }
  if (!fresh) {
    return reply({
      device: { id: device.id, name: device.name },
      source: 'last_report',
      reportedAt: device.lastSeenAt,
      harnesses: device.harnesses ?? [],
    });
  }
  try {
    const harnesses = await requestWorker(device.id, 'describe_harnesses');
    return reply({ device: { id: device.id, name: device.name }, source: 'worker', harnesses });
  } catch (err) {
    if (err instanceof WorkerUnavailableError) {
      return reply({ error: 'unavailable', message: `${device.name} is not connected right now.` }, { status: 409 });
    }
    // Not a 5xx: clients read gateway statuses as the home being unreachable.
    if (err instanceof WorkerRequestError) {
      return reply({ error: err.unsupported ? 'unsupported' : 'worker_error', message: err.message }, { status: 424 });
    }
    throw err;
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "fresh": rpcZ.string().optional() }).strict().optional() }).strict();

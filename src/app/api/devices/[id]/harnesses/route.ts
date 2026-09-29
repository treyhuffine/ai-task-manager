/**
 * The harnesses a device can run (docs/homes-build.md, P2.2). By default
 * the last report its worker sent. With `?fresh=1` the home asks the worker
 * now, over its stream. For the home's own device it looks here.
 */

import type { NextRequest } from 'next/server';
import { getDevice, getHome } from '@/lib/db/queries';
import { requestWorker, WorkerRequestError, WorkerUnavailableError } from '@/lib/workers/hub';
import { describeHarnesses } from '@/lib/worker/harnesses';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const device = getDevice(id);
  if (!device || device.status !== 'active') return Response.json({ error: 'not_found' }, { status: 404 });
  const fresh = request.nextUrl.searchParams.get('fresh') === '1';

  if (device.id === getHome()?.hostDeviceId) {
    return Response.json({ device: { id: device.id, name: device.name }, source: 'home', harnesses: await describeHarnesses({ refresh: fresh }) });
  }
  if (!fresh) {
    return Response.json({
      device: { id: device.id, name: device.name },
      source: 'last_report',
      reportedAt: device.lastSeenAt,
      harnesses: device.harnesses ?? [],
    });
  }
  try {
    const harnesses = await requestWorker(device.id, 'describe_harnesses');
    return Response.json({ device: { id: device.id, name: device.name }, source: 'worker', harnesses });
  } catch (err) {
    if (err instanceof WorkerUnavailableError) {
      return Response.json({ error: 'unavailable', message: `${device.name} is not connected right now.` }, { status: 409 });
    }
    // Not a 5xx: clients read gateway statuses as the home being unreachable.
    if (err instanceof WorkerRequestError) {
      return Response.json({ error: err.unsupported ? 'unsupported' : 'worker_error', message: err.message }, { status: 424 });
    }
    throw err;
  }
}

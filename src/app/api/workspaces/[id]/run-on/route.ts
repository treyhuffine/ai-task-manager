import { NextRequest, NextResponse } from 'next/server';
import { RunOnError, runOnFor, setDefaultDevice } from '@/lib/setups/run-on';

export const dynamic = 'force-dynamic';

/**
 * Where an agent's new executions can run, and where they run by default
 * (docs/homes-spec.md §3.3, P3.1): the launcher's Run on control.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runOn = runOnFor(id);
  if (!runOn) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(runOn);
}

/** "Make this the default": save the agent's default device, or clear it with null. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { defaultDeviceId?: unknown };
  const deviceId = body.defaultDeviceId;
  if (deviceId !== null && typeof deviceId !== 'string') {
    return NextResponse.json({ error: 'defaultDeviceId must be a device id, or null' }, { status: 400 });
  }
  try {
    return NextResponse.json(setDefaultDevice(id, deviceId));
  } catch (err) {
    if (err instanceof RunOnError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

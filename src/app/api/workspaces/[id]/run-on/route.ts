import { NextRequest, NextResponse } from 'next/server';
import { RunOnError, runOnFor, setDefaultComputer } from '@/lib/setups/run-on';

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

/** "Make this the default": save the agent's default computer, or clear it with null. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { defaultComputerId?: unknown };
  const computerId = body.defaultComputerId;
  if (computerId !== null && typeof computerId !== 'string') {
    return NextResponse.json({ error: 'defaultComputerId must be a computer id, or null' }, { status: 400 });
  }
  try {
    return NextResponse.json(setDefaultComputer(id, computerId));
  } catch (err) {
    if (err instanceof RunOnError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

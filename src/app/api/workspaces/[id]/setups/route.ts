import { NextRequest, NextResponse } from 'next/server';
import { getWorkspace } from '@/lib/db/queries';
import { runOnFor } from '@/lib/setups/run-on';
import { applySetup, planSetup, SetupUnavailableError, type SetupOutcome } from '@/lib/setups/set-up-agent';
import { SetupError } from '@/lib/setups/set-up-here';

export const dynamic = 'force-dynamic';

/**
 * Setting an agent up on one of the person's devices from the app
 * (docs/homes-model.md). GET says what it would do there: where a copy
 * would go and what comes along. POST does it, and answers with the agent's
 * setup there and where it can run now.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deviceId = request.nextUrl.searchParams.get('deviceId');
  if (!getWorkspace(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!deviceId) return NextResponse.json({ error: 'deviceId is required' }, { status: 400 });
  return answer(() => planSetup(id, deviceId));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getWorkspace(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as {
    deviceId?: unknown;
    how?: unknown;
    folder?: unknown;
    answers?: unknown;
  };
  if (typeof body.deviceId !== 'string') return NextResponse.json({ error: 'deviceId is required' }, { status: 400 });
  if (body.how !== 'copy' && body.how !== 'existing') return NextResponse.json({ error: 'how must be copy or existing' }, { status: 400 });
  if (body.folder !== undefined && body.folder !== null && typeof body.folder !== 'string') {
    return NextResponse.json({ error: 'folder must be a path, or null' }, { status: 400 });
  }
  const answers = body.answers ?? {};
  if (
    typeof answers !== 'object' ||
    Array.isArray(answers) ||
    Object.values(answers as Record<string, unknown>).some((v) => v !== null && typeof v !== 'string')
  ) {
    return NextResponse.json({ error: 'answers must map each reference to a folder, or null' }, { status: 400 });
  }
  const deviceId = body.deviceId;
  return answer(async (): Promise<SetupOutcome> => {
    const result = await applySetup(id, deviceId, {
      how: body.how as 'copy' | 'existing',
      folder: (body.folder as string | null | undefined) ?? null,
      answers: answers as Record<string, string | null>,
    });
    return { ...result, runOn: runOnFor(id) };
  });
}

async function answer(work: () => Promise<unknown>) {
  try {
    return NextResponse.json(await work());
  } catch (err) {
    if (err instanceof SetupUnavailableError) return NextResponse.json({ error: 'unavailable', message: err.message }, { status: 409 });
    if (err instanceof SetupError) return NextResponse.json({ error: 'setup', message: err.message }, { status: 400 });
    throw err;
  }
}

import { getWorkspace } from '@/lib/db/queries';
import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { runOnFor } from '@/lib/setups/run-on';
import { applySetup, planSetup, SetupUnavailableError, type SetupOutcome } from '@/lib/setups/set-up-agent';
import { SetupError } from '@/lib/setups/set-up-here';
import { z as rpcZ } from 'zod/v4';

/**
 * Setting an agent up on one of the person's devices from the app
 * (docs/homes-model.md). GET says what it would do there: where a copy
 * would go and what comes along. POST does it, and answers with the agent's
 * setup there and where it can run now.
 */
export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  const deviceId = searchParams(rpcInput.query).get('deviceId');
  if (!getWorkspace(id)) return reply({ error: 'not_found' }, { status: 404 });
  if (!deviceId) return reply({ error: 'deviceId is required' }, { status: 400 });
  return answer(() => planSetup(id, deviceId));
}

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  if (!getWorkspace(id)) return reply({ error: 'not_found' }, { status: 404 });
  const body = (rpcInput.body) as {
    deviceId?: unknown;
    how?: unknown;
    folder?: unknown;
    answers?: unknown;
  };
  if (typeof body.deviceId !== 'string') return reply({ error: 'deviceId is required' }, { status: 400 });
  if (body.how !== 'copy' && body.how !== 'existing') return reply({ error: 'how must be copy or existing' }, { status: 400 });
  if (body.folder !== undefined && body.folder !== null && typeof body.folder !== 'string') {
    return reply({ error: 'folder must be a path, or null' }, { status: 400 });
  }
  const answers = body.answers ?? {};
  if (
    typeof answers !== 'object' ||
    Array.isArray(answers) ||
    Object.values(answers as Record<string, unknown>).some((v) => v !== null && typeof v !== 'string')
  ) {
    return reply({ error: 'answers must map each reference to a folder, or null' }, { status: 400 });
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

async function answer<T>(work: () => Promise<T>) {
  try {
    return reply(await work());
  } catch (err) {
    if (err instanceof SetupUnavailableError) return reply({ error: 'unavailable', message: err.message }, { status: 409 });
    if (err instanceof SetupError) return reply({ error: 'setup', message: err.message }, { status: 400 });
    throw err;
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "deviceId": rpcZ.string().optional() }).strict().optional() }).strict();
export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "deviceId": rpcZ.string().optional(), "how": rpcZ.string().optional(), "folder": rpcZ.string().nullable().optional(), "answers": rpcZ.record(rpcZ.string(), rpcZ.string().nullable()).optional() }).strict().default({}) }).strict();

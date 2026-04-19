import { NextRequest } from 'next/server';
import { getProvider } from '@agentex/agent';

const ALLOWED = new Set(['claude', 'codex']);

export async function POST(request: NextRequest) {
  try {
    const { adapter } = await request.json();
    if (!ALLOWED.has(adapter)) {
      return Response.json({ error: `unknown adapter: ${adapter}` }, { status: 400 });
    }

    const provider = getProvider(adapter);
    const result = await provider.testEnvironment({ providerType: adapter });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      {
        status: 'fail',
        checks: [{ code: 'probe_error', level: 'error', message }],
      },
      { status: 200 },
    );
  }
}

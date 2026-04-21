import { NextRequest } from 'next/server';
import { getProvider } from '@agentex/agent';

const ALLOWED = new Set(['claude', 'codex']);

export async function POST(request: NextRequest) {
  try {
    const { harness } = await request.json();
    if (!ALLOWED.has(harness)) {
      return Response.json({ error: `unknown harness: ${harness}` }, { status: 400 });
    }

    const provider = getProvider(harness);
    const result = await provider.testEnvironment({ providerType: harness });
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

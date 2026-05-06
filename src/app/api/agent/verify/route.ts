import { NextRequest } from 'next/server';
import { getProvider, clearAuthCache } from '@agentex/agent';
import { CHEAPEST_MODEL } from '@/lib/executor/harness';

const ALLOWED = new Set(['claude', 'codex']);

export interface AgentVerifyResponse {
  ok: boolean;
  status: string;
  durationMs: number;
  costUsd: number | null;
  billingType: 'api' | 'subscription' | 'metered_api' | null;
  model: string | null;
  summary: string | null;
  errorMessage: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const { harness } = await request.json();
    if (!ALLOWED.has(harness)) {
      return Response.json({ error: `unknown harness: ${harness}` }, { status: 400 });
    }

    const provider = getProvider(harness);
    const start = Date.now();
    const result = await provider.execute({
      prompt: "Respond with 'ok'.",
      model: CHEAPEST_MODEL[harness],
      config: { timeoutSec: 20, maxTurns: 1 },
    });

    const ok = result.status === 'completed';

    // Invalidate the 60s auth cache after a successful round-trip so the
    // next /api/agent/auth call re-reads from source (e.g., user just
    // finished `claude login` and the verify confirmed it works).
    if (ok) clearAuthCache();

    const payload: AgentVerifyResponse = {
      ok,
      status: result.status,
      durationMs: Date.now() - start,
      costUsd: result.costUsd,
      billingType: result.billingType,
      model: result.model,
      summary: result.summary,
      errorMessage: result.errorMessage,
    };

    return Response.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

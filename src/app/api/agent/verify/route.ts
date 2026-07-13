import { NextRequest } from 'next/server';
import { getProvider, clearAuthCache } from '@agentex/agent';
import { isHarnessId } from '@/lib/agents/registry';
import { runtimeContextForHarness } from '@/lib/agents/runtime';
import { getAppRoot } from '@/lib/config/paths';
import { ensureAgentHarnessSettings } from '@/lib/db/queries';
import { getAgentModelCatalog } from '@/lib/agent-model-discovery';

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
    if (!isHarnessId(harness)) {
      return Response.json({ error: `unknown harness: ${harness}` }, { status: 400 });
    }

    const provider = getProvider(harness);
    const cwd = getAppRoot();
    const settings = ensureAgentHarnessSettings(harness);
    const catalog = await getAgentModelCatalog(harness, { cwd, refresh: true });
    const model = (settings.defaultModel && catalog.some((entry) => entry.id === settings.defaultModel)
      ? settings.defaultModel
      : null)
      ?? settings.enabledModels.find((id) => catalog.some((entry) => entry.id === id))
      ?? catalog[0]?.id;
    if (!model) {
      return Response.json({ error: 'Select at least one model before verifying this harness' }, { status: 409 });
    }
    const usesDefaultTuning = model === settings.defaultModel;
    const runtime = await runtimeContextForHarness(harness, { cwd, refresh: true });
    const start = Date.now();
    const result = await provider.execute({
      prompt: "Respond with 'ok'.",
      model,
      cwd,
      env: runtime.env,
      config: {
        ...runtime.config,
        model,
        ...(usesDefaultTuning && settings.defaultVariant ? { modelVariant: settings.defaultVariant } : {}),
        ...(usesDefaultTuning && settings.defaultEffort ? { effort: settings.defaultEffort } : {}),
        timeoutSec: 20,
        maxTurns: 1,
      },
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

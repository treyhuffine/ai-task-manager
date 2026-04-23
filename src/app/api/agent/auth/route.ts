import { NextRequest } from 'next/server';
import { getProvider, type AuthReport } from '@agentex/agent';

const ALLOWED = new Set(['claude', 'codex']);

// We return the full AuthReport the SDK gives us, plus a few precomputed
// flags so the client doesn't have to rewalk `options[]` to figure out what
// to render.
export interface AgentAuthResponse extends AuthReport {
  hasSubscription: boolean;
  hasApiKey: boolean;
  hasBedrock: boolean;
  /** Env var name for the first detected API key, for UI hints. */
  apiKeyVar: string | null;
}

function hasMethod(report: AuthReport, method: 'subscription' | 'api_key' | 'bedrock'): boolean {
  return report.options.some((o) => o.method === method && o.present === true);
}

function firstApiKeyVar(report: AuthReport): string | null {
  const opt = report.options.find((o) => o.method === 'api_key' && o.present === true);
  if (!opt) return null;
  if (opt.source.kind === 'env') return opt.source.var;
  if (opt.source.kind === 'env_combo') return opt.source.vars.join(' + ');
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const { harness, fresh } = await request.json();
    if (!ALLOWED.has(harness)) {
      return Response.json({ error: `unknown harness: ${harness}` }, { status: 400 });
    }

    const provider = getProvider(harness);
    const report = await provider.resolveAuth({ fresh: fresh === true });

    const payload: AgentAuthResponse = {
      ...report,
      hasSubscription: hasMethod(report, 'subscription'),
      hasApiKey: hasMethod(report, 'api_key'),
      hasBedrock: hasMethod(report, 'bedrock'),
      apiKeyVar: firstApiKeyVar(report),
    };

    return Response.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

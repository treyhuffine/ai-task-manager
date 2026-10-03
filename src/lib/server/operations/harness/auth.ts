import { getAppRoot } from '@/lib/config/paths';
import { openCodeProviderManager, openCodeRuntimeContext } from '@/lib/harness/opencode';
import { getHarnessRuntime, resolveHarnessAuth } from '@/lib/harness/runtime';
import { reply, type OperationContext } from '@/lib/server/operation';
import type { AuthReport } from '@agentex/agent';
import { z as rpcZ } from 'zod/v4';

// We return the full AuthReport the SDK gives us, plus a few precomputed
// flags so the client doesn't have to rewalk `options[]` to figure out what
// to render.
export interface HarnessAuthResponse extends AuthReport {
  hasSubscription: boolean;
  hasApiKey: boolean;
  hasBedrock: boolean;
  /** Env var name for the first detected API key, for UI hints. */
  apiKeyVar: string | null;
  runtime: Awaited<ReturnType<typeof getHarnessRuntime>>;
  hasConfiguredUpstream: boolean;
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

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { harness, fresh } = rpcInput.body;

    const [report, runtime, hasConfiguredUpstream] = await Promise.all([
      resolveHarnessAuth(harness, { cwd: getAppRoot(), fresh: fresh === true }),
      getHarnessRuntime(harness, { cwd: getAppRoot(), refresh: fresh === true }),
      harness === 'opencode'
        ? openCodeProviderManager().list(await openCodeRuntimeContext(fresh === true))
          .then((providers) => providers.some((provider) => provider.connected))
          .catch(() => false)
        : Promise.resolve(false),
    ]);

    const payload: HarnessAuthResponse = {
      ...report,
      hasSubscription: hasMethod(report, 'subscription'),
      hasApiKey: hasMethod(report, 'api_key'),
      hasBedrock: hasMethod(report, 'bedrock'),
      apiKeyVar: firstApiKeyVar(report),
      runtime,
      hasConfiguredUpstream,
    };

    return reply(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return reply({ error: message }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ harness: rpcZ.enum(['claude', 'codex', 'cursor', 'opencode', 'antigravity']), fresh: rpcZ.boolean().optional() }).strict() }).strict();

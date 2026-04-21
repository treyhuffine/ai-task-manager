import { NextRequest } from 'next/server';
import { getProvider, type AuthReport } from '@agentex/agent';

const ALLOWED = new Set(['claude', 'codex']);

// We don't use the canned `hasSubscription`/`hasApiKey` helpers because we
// also need the env var name (for UI hints) and the keychain-unknown flag.
// Inlining keeps it to one `resolveAuth` call.
function hasMethod(report: AuthReport, method: 'subscription' | 'api_key'): boolean {
  return report.options.some((o) => o.method === method && o.present === true);
}

function firstApiKeyVar(report: AuthReport): string | null {
  const opt = report.options.find((o) => o.method === 'api_key' && o.present === true);
  if (!opt) return null;
  if (opt.source.kind === 'env') return opt.source.var;
  if (opt.source.kind === 'env_combo') return opt.source.vars.join(' + ');
  return null;
}

function hasKeychainUnknown(report: AuthReport): boolean {
  return report.options.some(
    (o) => o.method === 'subscription' && o.present === 'unknown',
  );
}

export async function POST(request: NextRequest) {
  try {
    const { harness } = await request.json();
    if (!ALLOWED.has(harness)) {
      return Response.json({ error: `unknown harness: ${harness}` }, { status: 400 });
    }

    const provider = getProvider(harness);

    const [report, models] = await Promise.all([
      provider.resolveAuth(),
      provider.listModels
        ? provider.listModels({ cacheTtlMs: 60_000 }).catch(() => [])
        : Promise.resolve([]),
    ]);

    return Response.json({
      providerType: report.providerType,
      hasSubscription: hasMethod(report, 'subscription'),
      hasApiKey: hasMethod(report, 'api_key'),
      apiKeyVar: firstApiKeyVar(report),
      keychainUnknown: hasKeychainUnknown(report),
      models: models.map((m) => ({ id: m.id, name: m.name })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

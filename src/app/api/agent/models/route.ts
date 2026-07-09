import { getAgentModels } from '@/lib/agent-model-discovery';
import type { ProviderId } from '@/lib/agent-options';

const ALLOWED = new Set<ProviderId>(['claude', 'codex']);

export async function GET(request: Request) {
  const provider = new URL(request.url).searchParams.get('provider') as ProviderId | null;
  if (!provider || !ALLOWED.has(provider)) {
    return Response.json({ error: `unknown provider: ${provider ?? ''}` }, { status: 400 });
  }

  const result = await getAgentModels(provider);
  return Response.json(result);
}

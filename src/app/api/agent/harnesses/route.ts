import { HARNESS_IDS, HARNESS_REGISTRY } from '@/lib/agents/registry';
import { getHarnessRuntime } from '@/lib/agents/runtime';
import { ensureAgentHarnessSettings } from '@/lib/db/queries';
import { getAppRoot } from '@/lib/config/paths';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const refresh = url.searchParams.get('refresh') === 'true';
  const cwd = url.searchParams.get('cwd') || getAppRoot();
  const harnesses = await Promise.all(HARNESS_IDS.map(async (id) => ({
    ...HARNESS_REGISTRY[id],
    runtime: await getHarnessRuntime(id, { cwd, refresh }),
    settings: ensureAgentHarnessSettings(id),
  })));
  return Response.json({ harnesses });
}


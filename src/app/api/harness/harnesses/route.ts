import { HARNESS_IDS, HARNESS_REGISTRY } from '@/lib/harness/registry';
import { getHarnessRuntime } from '@/lib/harness/runtime';
import { ensureHarnessSettings } from '@/lib/db/queries';
import { getAppRoot } from '@/lib/config/paths';
import { withCompression } from '@/lib/api/compression';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: Request) {
  const url = new URL(request.url);
  const refresh = url.searchParams.get('refresh') === 'true';
  const cwd = url.searchParams.get('cwd') || getAppRoot();
  const harnesses = await Promise.all(HARNESS_IDS.map(async (id) => ({
    ...HARNESS_REGISTRY[id],
    runtime: await getHarnessRuntime(id, { cwd, refresh }),
    settings: ensureHarnessSettings(id),
  })));
  return Response.json({ harnesses });
}


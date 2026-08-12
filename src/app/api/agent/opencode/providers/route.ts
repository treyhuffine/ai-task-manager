import { openCodeProviderManager, openCodeRuntimeContext } from '@/lib/agents/opencode';
import { withCompression } from '@/lib/api/compression';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: Request) {
  try {
    const refresh = new URL(request.url).searchParams.get('refresh') === 'true';
    const manager = openCodeProviderManager();
    const providers = await manager.list(await openCodeRuntimeContext(refresh));
    return Response.json({ providers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}


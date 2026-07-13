import { openCodeProviderManager, openCodeRuntimeContext } from '@/lib/agents/opencode';

export async function GET(request: Request) {
  try {
    const refresh = new URL(request.url).searchParams.get('refresh') === 'true';
    const manager = openCodeProviderManager();
    const providers = await manager.list(await openCodeRuntimeContext(refresh));
    return Response.json({ providers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}


import { clearCursorApiKey, cursorCredentialStatus, setCursorApiKey } from '@/lib/agents/credentials';
import { clearHarnessRuntimeCache } from '@/lib/agents/runtime';
import { clearAgentModelCache } from '@/lib/agent-model-discovery';
import { clearAuthCache } from '@agentex/agent';
import { withCompression } from '@/lib/api/compression';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET() {
  return Response.json(cursorCredentialStatus());
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { apiKey?: unknown };
    if (typeof body.apiKey !== 'string') return Response.json({ error: 'apiKey is required' }, { status: 400 });
    const status = await setCursorApiKey(body.apiKey);
    const { recycleHarnessSessions } = await import('@/lib/executor/adapter');
    await recycleHarnessSessions('cursor');
    clearAuthCache();
    clearHarnessRuntimeCache('cursor');
    clearAgentModelCache('cursor');
    return Response.json(status);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function DELETE() {
  const status = clearCursorApiKey();
  const { recycleHarnessSessions } = await import('@/lib/executor/adapter');
  await recycleHarnessSessions('cursor');
  clearAuthCache();
  clearHarnessRuntimeCache('cursor');
  clearAgentModelCache('cursor');
  return Response.json(status);
}

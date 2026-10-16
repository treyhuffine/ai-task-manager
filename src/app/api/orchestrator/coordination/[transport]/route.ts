import { createMcpHandler } from 'mcp-handler';
import { actions } from '@/lib/orchestrator/registry';
import { runAction } from '@/lib/orchestrator/dispatch';
import { mcpCallContext } from '@/lib/orchestrator/mcp-caller';
import { callerChat } from '@/lib/coordination/service';
import { COORDINATION_TOOLS, COORDINATION_INSTRUCTIONS } from '@/lib/coordination/surface';

async function handle(request: Request) {
  const ctx = mcpCallContext(request.headers);
  try { callerChat(ctx); }
  catch { return Response.json({ error: 'Coordination requires a signed personal Ri chat.' }, { status: 403 }); }
  const names = new Set<string>(COORDINATION_TOOLS);
  const handler = createMcpHandler(server => {
    for (const action of actions.filter(action => names.has(action.name))) server.registerTool(action.name,
      { description: action.description, inputSchema: action.params }, async (input: Record<string, unknown>) => {
        const envelope = await runAction(action.name, input, ctx);
        return { content: [{ type: 'text' as const, text: JSON.stringify(envelope) }], isError: !envelope.ok };
      });
  }, { serverInfo: { name: 'ri-coordination', version: '0.1.0' }, instructions: COORDINATION_INSTRUCTIONS },
  { basePath: '/api/orchestrator/coordination', maxDuration: 120, verboseLogs: false });
  return handler(request);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;

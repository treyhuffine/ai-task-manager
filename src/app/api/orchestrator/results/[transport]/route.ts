import { createMcpHandler } from 'mcp-handler';
import { discoverableResultActions, resultActions, handleUndiscoveredResultCall } from '@/lib/orchestrator/result-actions';
import { runAction } from '@/lib/orchestrator/dispatch';
import { mcpCallContext } from '@/lib/orchestrator/mcp-caller';
import { getChatSession, getWorkResultAiReviewForSession } from '@/lib/db/queries';

async function handle(request: Request) {
  const staleCall = await handleUndiscoveredResultCall(request);
  if (staleCall) return staleCall;
  const actor = mcpCallContext(request.headers).actor;
  const session = actor?.sessionId ? getChatSession(actor.sessionId) : null;
  const assigned = session?.surfaceKind === 'result_review' ? getWorkResultAiReviewForSession(session.id) : null;
  // An admitted reviewer keeps the finishing action after disable. Admission itself
  // is still guarded in the query layer against the exact running request.
  const available = assigned
    ? resultActions.filter((action) => ['get_result', 'report_result_review'].includes(action.name))
    : discoverableResultActions();
  const handler = createMcpHandler((server) => {
    for (const action of available) server.registerTool(action.name, { description: action.description, inputSchema: action.params }, async (input: Record<string, unknown>) => {
      const envelope = await runAction(action.name, input, mcpCallContext(request.headers, { allowMissing: ['report_result', 'report_result_review'].includes(action.name) }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(envelope) }], isError: !envelope.ok };
    });
  }, {
    serverInfo: { name: 'ri-results', version: '0.1.0' },
    instructions: assigned ? 'Inspect only your assigned exact result. Save your findings with report_result_review and the assigned review_id. Do not edit, accept, complete, merge, or publish work.' : 'When meaningful work is finished, call get_handoff_context before preparing a handoff, then save it with report_result. Ordinary questions, progress and confirmations stay in chat. Independent review is requested explicitly by the user or scheduled by Ri settings. Use a stable request_id for retries.',
  }, { basePath: '/api/orchestrator/results', maxDuration: 120, verboseLogs: false });
  return handler(request);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;

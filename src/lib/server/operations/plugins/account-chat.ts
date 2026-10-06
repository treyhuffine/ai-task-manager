import { randomUUID } from 'node:crypto';
import { jsonSchemaToZodObject, mcpToolVisible, type McpToolRegistrar } from '@connectors/engine/mcp';
import { getConnectorRuntime } from '@/lib/connectors/runtime';
import { OperationError } from '@/lib/server/operation';
import { accountEvaluationRpc, accountViewInvocation } from './account-evaluation';

type Turn = { handle: string; viewer: string; source: string; turnId: string; toolName: string; expires: number; input?: Record<string, unknown>; reply?: Awaited<ReturnType<typeof accountEvaluationRpc>>; promise?: Promise<Awaited<ReturnType<typeof accountEvaluationRpc>>>; applied?: boolean; capturing?: boolean };
const globals = globalThis as typeof globalThis & { __riAccountChatTurns?: Map<string, Turn> };
const turns = globals.__riAccountChatTurns ??= new Map();
function fail(message: string, status = 403): never { throw new OperationError(status, { error: 'account_chat_unavailable', message }); }
function prune() { for (const [id, turn] of turns) if (turn.expires <= Date.now()) turns.delete(id); }
export async function beginAccountChat(handle: string, viewer: string, source: string, turnId: string, toolName: string) {
  const view = await accountViewInvocation(handle, viewer, source);
  if (view.tool.name !== toolName) fail('The selected account tool changed. Attach its current result again.');
  prune(); if (turns.size >= 128) fail('The temporary account chat is busy.', 429);
  const ticket = randomUUID();
  turns.set(ticket, { handle, viewer, source, turnId, toolName, expires: Math.min(view.session.expires, Date.now() + 15 * 60 * 1000) });
  return { ticket, toolName, account: view.session.view.snapshot.displayName };
}
async function checked(ticket: string) {
  prune(); const turn = turns.get(ticket);
  if (!turn) fail('This account chat ended. No call was replayed.', 410);
  const view = await accountViewInvocation(turn.handle, turn.viewer, turn.source);
  if (view.tool.name !== turn.toolName || !mcpToolVisible(view.tool, 'model')) fail('This account tool is no longer available.');
  return { turn, view };
}
/** A restricted branch of Ri's existing integration gateway, with one UI tool. */
export async function serveAccountChat(server: McpToolRegistrar, ticket: string) {
  const { turn, view } = await checked(ticket);
  const id = `${view.session.view.snapshot.providerId}.${turn.toolName}`;
  const action = (await getConnectorRuntime()).getToolkits().flatMap(toolkit => toolkit.actions).find(action => action.id === id);
  if (!action || action.modelVisible === false) fail('The account tool is unavailable.');
  // The ordinary toolkit merges schemas across accounts. This pinned view
  // advertises only the selected connection's actual tool definition.
  const shape = jsonSchemaToZodObject(view.tool.inputSchema).shape;
  server.registerTool(turn.toolName, { description: `${view.tool.description ?? turn.toolName}\nThis call acts on ${view.session.view.snapshot.displayName}. Use at most once. Existing account policies and human approvals apply.`, inputSchema: shape }, async args => {
    await checked(ticket);
    if (turn.promise && JSON.stringify(turn.input) !== JSON.stringify(args)) return { content: [{ type: 'text', text: 'This turn already submitted a different account operation. No call was repeated.' }], isError: true };
    turn.input ??= args;
    turn.promise ??= accountEvaluationRpc({ handle: turn.handle, method: 'tools/call', name: turn.toolName, arguments: args, invocationId: turn.turnId, audience: 'model' }, turn.viewer);
    turn.reply = await turn.promise;
    const raw = turn.reply.result as { content?: unknown[]; structuredContent?: unknown; isError?: boolean };
    // UI-private metadata is deliberately absent from the model-facing result.
    const data = JSON.stringify({ content: raw.content, structuredContent: raw.structuredContent, isError: raw.isError, ...(turn.reply.approvalIds?.length ? { message: 'Human approval is required. Stop and wait for their decision in Ri.' } : { message: 'The account call completed. The host will render its captured result if the attached context is still current.' }) }).slice(0, 12000);
    return { content: [{ type: 'text', text: data }], isError: raw.isError };
  });
}
export async function accountChatStatus(ticket: string) {
  const { turn } = await checked(ticket);
  if (!turn.promise) return { status: 'unused' as const };
  try {
    await turn.promise;
    if (turn.reply?.approvalIds?.length) return { status: 'approval' as const, ticket, toolName: turn.toolName, arguments: turn.input ?? {}, approvalIds: turn.reply.approvalIds };
    if ((turn.reply?.result as { isError?: boolean })?.isError) return { status: 'unknown' as const };
    return { status: 'ready' as const, view: { invocationId: turn.source }, ticket };
  } catch { return { status: 'unknown' as const }; }
}
export async function accountChatCapture(ticket: string, viewer: string, retryApproval = false) {
  const { turn } = await checked(ticket);
  if (turn.viewer !== viewer || turn.applied || turn.capturing || !turn.promise || !turn.input) fail('This account result is unavailable.', 409);
  turn.capturing = true;
  try {
    if (retryApproval && turn.reply?.approvalIds?.length) {
      turn.promise = accountEvaluationRpc({ handle: turn.handle, method: 'tools/call', name: turn.toolName, arguments: turn.input, invocationId: turn.turnId, audience: 'model', retryApproval: true }, viewer);
      turn.reply = await turn.promise;
    } else await turn.promise;
    await checked(ticket);
    if (!turn.reply || turn.reply.approvalIds?.length || (turn.reply.result as { isError?: boolean }).isError) fail('This operation needs approval or did not complete. No accepted call was repeated.', 409);
    turn.applied = true;
    return { kind: 'view' as const, invocationId: turn.source, toolName: turn.toolName, input: turn.input, result: turn.reply.result };
  } finally { turn.capturing = false; }
}

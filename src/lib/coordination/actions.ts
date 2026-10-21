import { z } from 'zod';
import * as q from '@/lib/db/queries';
import type { AgentRequestRecord } from '@/db/types';
import { EFFORT_LEVELS, PERMISSION_MODES } from '@/db/types';
import { KNOWN_HARNESS_IDS } from '@/lib/harness/registry';
import { INTEGRATION_LABELS } from '@/constants/integrations';
import { isBrowserEnabled } from '@/lib/browser/config';
import { defineAction, ActionError } from '@/lib/orchestrator/types';
import { callerChat, currentAgentAddresses, drainAgentCoordination, inCoordinationServer, personalChat, submitAgentRequest } from './service';

const requestShape = {
  target: z.string().min(1).describe('orchestrator, agent (this execution\'s own agent), requester, agent:<workspace id>, or session:<chat id>.'),
  request_id: z.string().min(1).max(200),
  content: z.string().trim().min(1).max(100_000),
};

/** The same receipt contract applies to messages and new assignments. */
function agentRequestReceipt(request: AgentRequestRecord) {
  const responseRequired = request.kind !== 'message';
  return {
    id: request.id, status: request.status, target: request.targetAddress, targetSessionId: request.targetSessionId,
    response_required: responseRequired, return_delivery: responseRequired ? 'automatic' as const : 'none' as const,
    note: responseRequired
      ? 'Accepted for tracked delivery. This is not the answer. The outcome returns automatically. Continue independent work, or end your turn if waiting.'
      : 'Accepted for delivery. No automatic response will be returned. Inspect get_agent_request if you need delivery state.',
  };
}

export const coordinationActions = [
  defineAction({
    name: 'get_session_context',
    description: `Describe this signed chat, its stable agent and orchestrator addresses, actual harness capabilities, configured ${INTEGRATION_LABELS.singular} and browser reach, and incoming requests. Use before consulting or delegating. Addresses survive New chat. Team and internal reviewer chats use separate surfaces.`,
    params: {},
    handler: async (ctx) => {
      const chat = callerChat(ctx);
      const workspace = chat.workspaceId ? q.getWorkspace(chat.workspaceId) : null;
      const placement = q.chatPlacement(chat.id);
      const { harnessCapabilitiesOn } = await import('@/lib/executor/devices');
      const caps = await harnessCapabilitiesOn(placement ?? { deviceId: '', isHome: true }, chat.harness, placement?.isHome === false ? undefined : workspace?.cwd);
      return { session: { id: chat.id, type: chat.type, workspaceId: chat.workspaceId, executionId: chat.executionId, harness: chat.harness, status: chat.status },
        addresses: await currentAgentAddresses(chat),
        capabilities: { ...caps, nativeCoordination: caps.strictMcpIsolation, signedCli: true,
          integrations: caps.strictMcpIsolation, integrationScopes: workspace?.integrationScopes ?? null,
          browser: isBrowserEnabled() && (workspace?.browserEnabled ?? true) && caps.strictMcpIsolation },
        incomingRequests: q.openAgentRequestsForTarget(chat.id).slice(0, 20).map(request => ({ id: request.id, from: request.sourceAddress, kind: request.kind, status: request.status, content: request.content.slice(0, 2000) })) };
    },
  }),
  defineAction({
    name: 'message_agent',
    strictParams: true,
    description: 'Message an existing Ri chat using a stable agent address or session:<chat id>. Both modes deliver the message and start a turn when the recipient is available. Choose response:"required" for an automatic return of its final answer, failure, or blocked-state update. Choose response:"none" for information or steering with no automatic return. Returns an acceptance receipt, not a completed answer. Reuse request_id only for unchanged intent. Continue independent work, or finish your turn if waiting. Read get_agent_request when inspection is needed, rather than polling transcripts.',
    params: { ...requestShape, response: z.enum(['required', 'none']).describe('Required: track the outcome and resume this chat automatically. None: deliver only, with no automatic return.') },
    mutating: true,
    handler: (ctx, input) => inCoordinationServer(ctx, 'message_agent', input, async () => agentRequestReceipt(await submitAgentRequest(ctx, { target: input.target, requestId: input.request_id, content: input.content, kind: input.response === 'required' ? 'question' : 'message' }))),
  }),
  defineAction({
    name: 'delegate_work',
    strictParams: true,
    description: 'Assign work to a new chat in an agent. Use message_agent to contact an existing chat. Records the requesting chat and returns a durable request. Completion, failure, and blocked-state updates return to your chat automatically. Returns an acceptance receipt, not completed work. Finish your turn if waiting. Code work stays visible in a chat and uses the existing worktree/device/model rules. Use a stable request_id on retry.',
    params: {
      request_id: requestShape.request_id,
      workspace_id: z.string().min(1),
      prompt: requestShape.content,
      provider: z.enum(KNOWN_HARNESS_IDS).optional(), model: z.string().min(1).optional(), effort: z.enum(EFFORT_LEVELS).optional(),
      permission_mode: z.enum(PERMISSION_MODES).optional(),
      task_id: z.string().min(1).optional(),
      device_id: z.string().min(1).optional().describe('Requested device, otherwise the agent default. An unavailable device is refused, never silently replaced.'),
      label: z.string().min(1).optional(),
    },
    mutating: true,
    handler: (ctx, input) => inCoordinationServer(ctx, 'delegate_work', input, async () => agentRequestReceipt(await submitAgentRequest(ctx, {
      target: `agent:${input.workspace_id}`, requestId: input.request_id, content: input.prompt, kind: 'delegation',
      options: { workspaceId: input.workspace_id, ...(input.provider ? { provider: input.provider } : {}), ...(input.model ? { model: input.model } : {}), ...(input.effort ? { effort: input.effort } : {}), ...(input.permission_mode ? { permissionMode: input.permission_mode } : {}), ...(input.task_id ? { taskId: input.task_id } : {}), ...(input.device_id ? { deviceId: input.device_id } : {}), ...(input.label ? { label: input.label } : {}) },
    }))),
  }),
  defineAction({
    name: 'get_agent_request', description: 'Read a durable request, its exact responding chat/run, answer, and delivery state. Reading never restarts work.',
    params: { id: z.string().min(1) },
    handler: (ctx, { id }) => {
      const caller = callerChat(ctx);
      const request = q.getAgentRequest(id);
      if (!request) throw new ActionError('not_found', 'Request not found.');
      personalChat(request.sourceSessionId, caller.userId);
      return { ...request, deliveries: q.listAgentDeliveries(id).map(({ content, ...delivery }) => ({ ...delivery, contentExcerpt: content.slice(0, 1000) })) };
    },
  }),
  defineAction({
    name: 'list_agent_requests', description: 'List this chat\'s incoming or outgoing durable requests, including pending consultations and delegated work.',
    params: { direction: z.enum(['incoming', 'outgoing']).optional(), limit: z.number().int().min(1).max(100).optional() },
    handler: (ctx, input) => q.listAgentRequests(callerChat(ctx).id, input.direction, input.limit).map(({ content, response, ...request }) => ({ ...request, contentExcerpt: content.slice(0, 1500), responseExcerpt: response?.slice(0, 1500) ?? null })),
  }),
  defineAction({
    name: 'reply_agent_request', description: 'Explicitly answer an incoming request from its assigned responding chat. Repeating the same answer is safe. The saved answer is delivered to the requesting chat. A final response can also answer automatically when this turn ends.',
    params: { id: z.string().min(1), content: requestShape.content },
    mutating: true,
    handler: (ctx, input) => inCoordinationServer(ctx, 'reply_agent_request', input, () => {
      const caller = callerChat(ctx);
      const request = q.getAgentRequest(input.id);
      if (!request || request.targetSessionId !== caller.id) throw new ActionError('unsupported', 'Only the assigned responding chat can answer this request.');
      if (request.kind === 'message') throw new ActionError('invalid_params', 'This message requested no automatic response. Use message_agent to send a separate message if useful.');
      if (request.status === 'completed' && request.response !== input.content) throw new ActionError('conflict', 'This request already has a different answer.');
      if (['failed', 'cancelled'].includes(request.status)) throw new ActionError('conflict', 'This request has already ended.');
      q.finishAgentRequest(request.id, 'completed', input.content);
      void drainAgentCoordination();
      return q.getAgentRequest(request.id);
    }),
  }),
  defineAction({
    name: 'cancel_agent_request', description: 'Cancel an outgoing request. A delegated execution is stopped when still running. Cancelling a consultation does not stop unrelated work in the consulted agent\'s main chat.',
    params: { id: z.string().min(1) },
    mutating: true,
    handler: (ctx, input) => inCoordinationServer(ctx, 'cancel_agent_request', input, async () => {
      const caller = callerChat(ctx);
      const request = q.getAgentRequest(input.id);
      if (!request || request.sourceSessionId !== caller.id) throw new ActionError('unsupported', 'Only the requesting chat can cancel this request.');
      if (['completed', 'failed', 'cancelled'].includes(request.status)) return request;
      const pending = [request];
      for (let index = 0; index < pending.length; index++) {
        const current = pending[index];
        pending.push(...q.childAgentRequests(current));
        q.finishAgentRequest(current.id, 'cancelled', 'Cancelled by the requesting chat.');
        if (current.kind === 'delegation' && current.targetSessionId && current.runId && ['queued', 'running'].includes(q.getRun(current.runId)?.status ?? '')) {
          const { abort } = await import('@/lib/executor/adapter');
          await abort(current.targetSessionId);
        }
      }
      void drainAgentCoordination();
      return q.getAgentRequest(request.id);
    }),
  }),
];

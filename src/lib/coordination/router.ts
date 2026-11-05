import { TRPCError } from '@trpc/server';
import { ActionError } from '@/lib/orchestrator/types';
import { toChatEventDTO } from '@/lib/api/dto/chat-event';
import { z } from 'zod/v4';
import { viewerProcedure as p, router } from '@/lib/trpc/init';
import * as q from '@/lib/db/queries';
import { drainAgentCoordination, personalChat } from './service';
import { forwardToChat } from './human';
import { KNOWN_HARNESS_IDS } from '@/lib/harness/registry';
import { EFFORT_LEVELS, type AgentDeliveryRecord } from '@/db/types';
import { wakeDevice } from '@/lib/workers/hub';
import { actorFromRequest } from '@/lib/auth/actor';

const id = z.string().min(1).max(200);
const policy = z.enum(['ask', 'allow']).nullable();
const humanControl = p.use(({ ctx, next }) => {
  if (actorFromRequest(ctx.request.headers).source === 'ai') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Only a person can change coordination controls or forward messages as the person.' });
  }
  return next();
});
async function operation<T>(run: () => T | Promise<T>): Promise<T> {
  try { return await run(); } catch (error) {
    if (error instanceof ActionError) throw new TRPCError({code:error.code === 'not_found' ? 'NOT_FOUND' : error.code === 'invalid_params' ? 'BAD_REQUEST' : error.code === 'unsupported' ? 'FORBIDDEN' : 'CONFLICT',message:error.message});
    throw error;
  }
}
function deliveryView(delivery: AgentDeliveryRecord) {
  const request = delivery.requestId ? q.getAgentRequest(delivery.requestId) : null;
  const workspaceId = delivery.targetAddress.startsWith('agent:') ? delivery.targetAddress.slice(6) : null;
  return { ...delivery, destinationName: workspaceId ? q.getWorkspace(workspaceId)?.name ?? 'Unavailable agent' : null, launchOptions: request?.kind === 'delegation' ? request.options : delivery.payload.launch ?? null };
}
export const coordinationRouter = router({
  state: p.input(z.object({ sessionId: id })).query(({ input }) => {
    const chat = personalChat(input.sessionId, 'local');
    const active = q.activeCoordinationChats(chat.id);
    return { scopes: {chat:chat.id,execution:chat.executionId,agent:chat.workspaceId,global:'1'}, active, incoming:q.incomingAgentDeliveryState(chat.id), assignmentsWaiting:active.assignmentsWaiting, ...q.agentCoordinationPolicy(input.sessionId), pending: q.pendingAgentDeliveryCount(input.sessionId), approvals: q.pendingAgentApprovals(input.sessionId).map(deliveryView) };
  }),
  message: p.input(z.object({ sessionId: id, eventId: id })).query(({ input }) => {
    personalChat(input.sessionId, 'local');
    const event = q.getChatEventById(input.eventId);
    return event?.sessionId === input.sessionId ? toChatEventDTO(event) : null;
  }),
  delivery: p.input(z.object({ id })).query(({ input }) => {
    const delivery = q.getAgentDelivery(input.id);
    if (!delivery) return null;
    return deliveryView(delivery);
  }),
  defaults: p.query(() => ({ global: q.getUserState()?.agentCoordinationPolicy ?? null })),
  policy: humanControl.input(z.object({ scope: z.enum(['global', 'agent', 'execution', 'chat']), id, policy }).strict()).mutation(({ input }) => {
    const exists = input.scope === 'chat' ? q.getChatSession(input.id) : input.scope === 'agent' ? q.getWorkspace(input.id) : input.scope === 'execution' ? q.getExecution(input.id) : q.getUserState();
    if (!exists) throw new TRPCError({code:'NOT_FOUND',message:'Preference scope unavailable.'});
    q.setAgentCoordinationPolicy(input.scope, input.id, input.policy);
    return { saved: true };
  }),
  hold: humanControl.input(z.object({ sessionId: id, held: z.boolean() }).strict()).mutation(({ input }) => {
    personalChat(input.sessionId, 'local');
    q.setAgentCoordinationHold(input.sessionId, input.held);
    if (!input.held) {
      const placement = q.chatPlacement(input.sessionId);
      if (placement?.isHome === false) wakeDevice(placement.deviceId);
      void drainAgentCoordination();
    }
    return { held: input.held };
  }),
  decide: humanControl.input(z.object({ deliveryId: id, decision: z.enum(['allow', 'always', 'deny']) }).strict()).mutation(({ input }) => {
    if (!q.getAgentDelivery(input.deliveryId)) throw new TRPCError({code:'NOT_FOUND',message:'Delivery unavailable.'});
    const delivery = q.decideAgentDelivery(input.deliveryId, input.decision);
    void drainAgentCoordination();
    return delivery;
  }),
  targets: p.input(z.object({ search: z.string().max(200).optional(), workspaceId: id.optional(), excludeSessionId: id.optional() }).strict()).query(({ input }) => q.coordinationChatTargets(input)),
  forward: humanControl.input(z.object({ sendId: id, sourceEventId: id, directions: z.string().max(100_000), target: id.optional(), launch: z.object({ workspaceId: id, provider: z.enum(KNOWN_HARNESS_IDS).optional(), model: id.optional(), modelVariant: id.nullable().optional(), effort: z.enum(EFFORT_LEVELS).nullable().optional(), serviceTier: id.nullable().optional() }).strict().optional() }).strict()).mutation(({ input }) => operation(() => forwardToChat(input))),
});

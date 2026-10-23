import { apiErrorStatus } from '@/lib/api/error-status';
import { teamContentInput, teamContentResult } from '@/lib/team/mcp/input';
import { z } from 'zod';
import * as q from '@/lib/db/queries';
import { ActionError, defineAction, type Action, type ActionContext } from '@/lib/orchestrator/types';
import { isTeamAuthority } from '@/lib/home/authority';
import { assertCurrentTeam, recordTeamFailure, teamFor } from './connect';
import { workResultAttachmentSchema } from '@/lib/work-results/validation';
import { copyToTeam } from './commands';
import { replaceAttachmentReferences } from '@/lib/attachments/derive';
import { TEAM_TOOLS } from '@/lib/team/mcp/tools';

function authorize(ctx: ActionContext) {
  if (isTeamAuthority()) throw new ActionError('unsupported', 'Connected Home access belongs to a personal Home.');
  if (ctx.caller?.scope === 'home_content') throw new ActionError('unsupported', 'This external content connection is scoped to its personal Home.');
  if (!ctx.remote && ctx.caller?.location === 'home') return;
  const chat = ctx.actor?.sessionId ? q.getChatSession(ctx.actor.sessionId) : null;
  if (!chat || chat.status !== 'active' || chat.surfaceKind === 'result_review') throw new ActionError('unsupported', 'Connected Homes require an active signed Ri chat.');
}

const target = z.string().min(1).max(100).optional().describe('Stable Home ID from list_homes. Omit for the calling chat’s own Home. Never infer a destination from the current browser view or a record title.');

export async function callConnectedHome(ctx: ActionContext, homeId: string, name: string, input: Record<string, unknown>): Promise<{ target_home: { id: string; name: string }; result: unknown; replayed: boolean }> {
  authorize(ctx);
  const team = await teamFor(homeId);
  if (!team) throw new ActionError('not_found', 'That Home is unknown, disconnected, or revoked. Use list_homes and choose its stable ID.');
  const tool = TEAM_TOOLS.find((t) => t.name === name);
  if (!tool) throw new ActionError('unsupported', 'This operation is not available in a connected Home.');
  const { wire, areaStatus } = teamContentInput(name, input);
  const parsed = z.object(tool.shape).strict().safeParse(wire);
  if (!parsed.success) throw new ActionError('invalid_params', 'These fields are not valid for the selected Home.', undefined, parsed.error.issues);
  try {
    const response = tool.kind === 'read'
      ? await team.client.team.nativeRead.query({ action: name, input: parsed.data })
      : await team.client.team.nativeWrite.mutate({ action: name, input: parsed.data });
    assertCurrentTeam(team);
    if (!response.ok) {
      const code = response.error.code;
      throw new ActionError(code === 'not_found' ? 'not_found' : code === 'conflict' || code === 'body_conflict' || code === 'idempotency_conflict' ? 'conflict' : code === 'not_allowed' ? 'unsupported' : code === 'failed' ? 'conflict' : 'invalid_params', response.error.message, undefined, { ...response.error, retryable: code === 'failed' });
    }
    const result = teamContentResult(response.result, areaStatus);
    return { target_home: { id: team.connection.id, name: team.connection.name }, result, replayed: !!response.replayed };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    const status = apiErrorStatus(error);
    if (status === 401) recordTeamFailure(homeId, error, team);
    if (status && status >= 400 && status < 500) throw new ActionError(status === 401 || status === 403 ? 'unsupported' : status === 404 ? 'not_found' : 'invalid_params', error instanceof Error ? error.message : 'The Home refused this request.', undefined, { retryable: false });
    recordTeamFailure(homeId, error, team);
    throw new ActionError('conflict', error instanceof Error ? error.message : 'The selected Home could not be reached.', 'Retry against the same Home and reuse the idempotency_key. No personal fallback was attempted.');
  }
}

/** Add explicit targeting to existing contracts while retaining their local handlers. */
export function withConnectedHome(action: Action): Action {
  if (action.params.target_home_id) return action;
  const tool = TEAM_TOOLS.find((t) => t.name === action.name);
  if (!tool) return action;
  const additions: z.ZodRawShape = { target_home_id: target };
  if (tool.kind === 'write' && !action.params.idempotency_key) additions.idempotency_key = z.unknown().optional().describe('Required for connected-Home writes. Reuse the same value when retrying.');
  if ('assignee_member_id' in tool.shape) additions.assigneeMemberId = z.string().nullable().optional();
  // Native Team spellings are part of targeted calls too. Keep them visible
  // until the Team adapter runs, instead of silently stripping assignment/Area.
  for (const key of ['assigned_to_me', 'assignee_member_id', 'area_id', 'hard_deadline', 'decisions_only', 'entity_type', 'entity_id', 'order_by', 'session_id', 'acknowledged_execution_ids', 'acknowledged_child_ids']) {
    if (key in tool.shape && !action.params[key]) additions[key] = tool.shape[key as keyof typeof tool.shape].optional();
  }
  return {
    ...action,
    localContract: { params: action.params, description: action.description },
    params: { ...action.params, ...additions },
    description: `${action.description} To work in a connected team, call list_homes then pass target_home_id. Connected writes require idempotency_key and use canonical team IDs.`,
    handler: (ctx, input) => {
      const { target_home_id, ...rest } = input;
      if (target_home_id !== undefined && target_home_id !== q.getHome()?.id) return callConnectedHome(ctx, String(target_home_id), action.name, rest);
      const localInput = { ...rest };
      if (!action.params.idempotency_key) delete localInput.idempotency_key;
      const local = z.object(action.params).strict().safeParse(localInput);
      if (!local.success) throw new ActionError('invalid_params', 'These fields are not available in this personal Home.', undefined, local.error.issues);
      return action.handler(ctx, local.data);
    },
  };
}

function homeRead<const Name extends string>(name: Name) {
  const tool = TEAM_TOOLS.find((t) => t.name === name)!;
  return defineAction({
    name,
    description: `${name.replaceAll('_', ' ')} in the explicitly selected connected Home.`,
    params: { ...tool.shape, target_home_id: z.string().min(1) },
    handler: (ctx, { target_home_id, ...input }) => callConnectedHome(ctx, target_home_id, name, input),
  });
}

const qNativeNames = new Set(['list_tasks', 'get_task', 'create_task', 'update_task', 'complete_task', 'transition_task', 'list_notes', 'get_note', 'create_note', 'update_note', 'list_areas', 'get_area', 'search', 'get_session_messages', 'search_sessions']);

export const connectedHomeActions = [
  defineAction({
    name: 'publish_result',
    description: 'Explicitly publish a chosen summary and links to everyone in the selected team. Personal conversation and planning are not included. Does not change the shared task status. Reuse idempotency_key on retry.',
    params: {
      target_home_id: z.string().min(1), task_id: z.string().min(1), idempotency_key: z.string().min(8).max(200),
      summary: z.string().max(20_000).optional(),
      links: z.array(z.object({ label: z.string().min(1).max(200), url: z.string().url().max(2000) })).max(5).optional(),
      attachments: z.array(workResultAttachmentSchema).max(10).optional().describe('Chosen files in this personal Home, copied only by this explicit publication.'),
    },
    mutating: true,
    handler: async (ctx, { target_home_id, task_id, idempotency_key, ...input }): Promise<unknown> => {
      authorize(ctx);
      const team = await teamFor(target_home_id);
      if (!team) throw new ActionError('not_found', 'The selected Home is not connected.');
      try {
        const copies = [];
        const names = new Map<string, string>();
        for (const file of input.attachments ?? []) {
          assertCurrentTeam(team);
          const copy = await copyToTeam(team, file, idempotency_key);
          copies.push(copy);
          names.set(file.fileName, copy.fileName);
        }
        assertCurrentTeam(team);
        const response = await team.client.team.nativePublish.mutate({ taskId: task_id, requestId: idempotency_key, ...input, summary: input.summary ? replaceAttachmentReferences(input.summary, names) : input.summary, attachments: copies });
        assertCurrentTeam(team);
        return { target_home: { id: team.connection.id, name: team.connection.name }, ...response };
      } catch (error) {
        if (error instanceof ActionError) throw new ActionError(error.code, error.message, error.suggestion, { retryable: error.code === 'conflict', ...(error.details && typeof error.details === 'object' ? error.details : {}) });
        if (error instanceof q.TeamError) throw new ActionError(error.code === 'not_found' ? 'not_found' : error.code === 'not_allowed' ? 'unsupported' : 'invalid_params', error.message, undefined, { retryable: false });
        const data = (error as { data?: { code?: string; httpStatus?: number } })?.data;
        if (data?.httpStatus && data.httpStatus >= 400 && data.httpStatus < 500) {
          throw new ActionError(data.code === 'NOT_FOUND' ? 'not_found' : data.code === 'FORBIDDEN' || data.code === 'UNAUTHORIZED' ? 'unsupported' : 'invalid_params', error instanceof Error ? error.message : 'The team refused publication.', undefined, { retryable: false });
        }
        recordTeamFailure(target_home_id, error, team);
        throw new ActionError('conflict', error instanceof Error ? error.message : 'Publication could not be confirmed.', 'Retry with the same Home and idempotency_key.');
      }
    },
  }),
  defineAction({
    name: 'list_homes',
    description: 'Discover this chat’s Home and connected teams by stable ID, name, connection state and permitted content operations. Team reads do not import work. Choose a Home explicitly for a request naming a team. Duplicate names require disambiguation. No credentials are returned.',
    params: {},
    handler: async (ctx) => {
      authorize(ctx);
      const home = q.getHome();
      return {
        bound_home: home ? { id: home.id, name: home.name, kind: home.kind } : null,
        connected_homes: await Promise.all(q.listTeamConnections().map(async (c) => ({ id: c.id, name: c.name, kind: 'team', state: c.status, role: c.role, last_error: q.getTeamConnection(c.id)?.lastError, operations: await supportsNativeHome(c.id) ? [...TEAM_TOOLS.filter((t) => ['list_members', 'list_history', 'list_links', 'list_published_results'].includes(t.name) || qNativeNames.has(t.name)).map((t) => t.name), 'publish_result'] : [] }))),
      };
    },
  }),
  homeRead('list_members'),
  homeRead('list_links'),
  homeRead('list_history'),
  homeRead('list_published_results'),
];

/** Never advertise new native operations merely because credentials exist. */
async function supportsNativeHome(id: string): Promise<boolean> {
  const team = await teamFor(id);
  if (!team) return false;
  try {
    const result = await team.client.team.nativeRead.query({ action: 'list_members', input: {} });
    assertCurrentTeam(team);
    return result.ok;
  } catch (error) { recordTeamFailure(id, error, team); return false; }
}

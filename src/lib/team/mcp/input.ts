import { isDeepStrictEqual } from 'node:util';
import { ActionError } from '@/lib/orchestrator/types';
import { z } from 'zod';
/** The ordinary action spelling and native Team tools adapt through one contract. */
export const CONTENT_ALIASES: Record<string, string> = {
  workspaceId: 'workspace_id', requestId: 'request_id', permissionMode: 'permission_mode', taskId: 'task_id', deviceId: 'device_id', provider: 'harness',
  areaId: 'area_id', assigneeMemberId: 'assignee_member_id', hardDeadline: 'hard_deadline',
  decisionsOnly: 'decisions_only', entityType: 'entity_type', entityId: 'entity_id', orderBy: 'order_by', sessionId: 'session_id',
};
/** Only the published destination names are accepted. Separator/case variants
 * of Home/Team scope tokens refuse unless declared as an action's domain field. */
export function normalizeHomeDestination(input: Record<string, unknown>, shape: Record<string, unknown>) {
  const fields = { ...input };
  if ('targetHomeId' in fields) {
    if ('target_home_id' in fields && !isDeepStrictEqual(fields.target_home_id, fields.targetHomeId)) throw new ActionError('invalid_params', 'Choose one destination Home.');
    fields.target_home_id = fields.targetHomeId;
    delete fields.targetHomeId;
  }
  for (const key of Object.keys(fields)) {
    if (key === 'target_home_id' || key in shape || Object.entries(CONTENT_ALIASES).some(([a, b]) => (key === a && b in shape) || (key === b && a in shape))) continue;
    const token = key.replace(/[-_]/g, '').toLowerCase();
    if (/(?:home|team|space)/.test(token)) throw new ActionError('invalid_params', `Use target_home_id to select a Home. ${key} is not a parameter of this action. No write was attempted.`);
  }
  return fields;
}

/** Full --input overrides flags as one alias group. Conflicts within the JSON
 * object itself remain visible to dispatch and are refused there. */
export function mergeActionInput(flags: Record<string, unknown>, blob: Record<string, unknown>) {
  const merged = { ...flags };
  for (const [a, b] of [...Object.entries(CONTENT_ALIASES), ['targetHomeId', 'target_home_id']]) {
    if (a in blob || b in blob) { delete merged[a]; delete merged[b]; }
  }
  return { ...merged, ...blob };
}
/** Coalesce equal aliases and reject ambiguity before either Home can write. */
export function normalizeContentAliases(input: Record<string, unknown>, shape?: Record<string, unknown>) {
  const normalized = { ...input };
  for (const [personal, team] of Object.entries(CONTENT_ALIASES)) {
    if (shape && (!(personal in shape) && !(team in shape) || personal in shape && team in shape)) continue;
    const a = normalized[personal], b = normalized[team];
    if (a !== undefined && b !== undefined && !isDeepStrictEqual(a, b)) throw new ActionError('invalid_params', `Conflicting values for ${personal} and ${team}.`);
    const canonical = shape && personal in shape ? personal : team;
    delete normalized[personal]; delete normalized[team];
    if (a !== undefined || b !== undefined) normalized[canonical] = a ?? b;
    // Null is a deliberate clear, not an omitted alias.
    if (a === null || b === null) normalized[canonical] = null;
  }
  return normalized;
}
export function teamContentInput(name: string, input: Record<string, unknown>) {
  const wire = normalizeContentAliases(Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)));
  if (wire.decisions_only) wire.kind = 'decision';
  delete wire.decisions_only;
  if (name === 'list_tasks' && wire.status === 'active') wire.status = 'current';
  const areaStatus = name === 'list_areas' ? wire.status : undefined;
  if (areaStatus !== undefined) { wire.include_archived = areaStatus !== 'active'; delete wire.status; }
  return { wire, areaStatus };
}
/** HTTP session actions and the Team MCP normalize and validate together. */
export function parseTeamContentInput(name: string, shape: z.ZodRawShape, raw: unknown, homeId: string | undefined) {
  const input = normalizeHomeDestination(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}, shape);
  if ('target_home_id' in input && input.target_home_id !== homeId) throw new ActionError('unsupported', 'This connection acts only in its team.');
  delete input.target_home_id;
  const { wire, areaStatus } = teamContentInput(name, input);
  const parsed = z.object(shape).strict().safeParse(wire);
  if (!parsed.success) throw new ActionError('invalid_params', parsed.error.message);
  return { wire: parsed.data, areaStatus };
}
export function teamContentResult(result: unknown, areaStatus: unknown): unknown {
  return (areaStatus === 'archived' || areaStatus === 'inactive') && result && typeof result === 'object' && 'areas' in result
    ? { ...result, areas: (result.areas as { status: string }[]).filter(area => area.status === areaStatus) } : result;
}

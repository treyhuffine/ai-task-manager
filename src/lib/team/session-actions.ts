import { parseTeamContentInput, teamContentResult } from './mcp/input';
/** Team session tools use the Home's domain operations, never the agent's database connection. */
import * as q from '@/lib/db/queries';
import type { RequestKey } from '@/lib/auth/request-key';
import type { DispatchEnvelope } from '@/lib/orchestrator/dispatch';
import { TEAM_TOOLS, runTeamTool } from './mcp/tools';
import { nativeTeamTools } from './mcp/native-tools';
import { hasTeamCapability } from './capabilities';
import { ActionError } from '@/lib/orchestrator/types';

export async function runTeamSessionAction(key: RequestKey | null, name: string, raw: unknown): Promise<DispatchEnvelope> {
  const refuse = (message: string): DispatchEnvelope => ({ ok: false, action: name, error: { code: 'unsupported', message } });
  if (key?.scope !== 'team_ai' || !key.memberId || !key.teamAiTurnId) return refuse('This action requires an active Team chat session.');
  const active = q.activeTeamChatTurnById(key.teamAiTurnId, key.memberId);
  if (!active?.turn.requestingApiKeyId) return refuse('This member turn is no longer authorized.');
  const chat = q.getTeamChat(active.turn.chatSessionId);
  if (!chat || !hasTeamCapability(active.member, 'read', 'agent')) return refuse('This chat is unavailable.');
  const tool = TEAM_TOOLS.find(tool => tool.name === name);
  if (tool && chat.surfaceKind !== 'result_review') {
    if (!hasTeamCapability(active.member, tool.kind === 'read' ? 'read' : 'editContent', 'agent')) return refuse('This member cannot perform that operation.');
    let normalized: ReturnType<typeof parseTeamContentInput>;
    try {
      normalized = parseTeamContentInput(name, tool.shape, raw, q.getHome()?.id);
    }
    catch (error) {
      if (!(error instanceof ActionError)) throw error;
      return { ok: false, action: name, error: { code: error.code, message: error.message } };
    }
    const { wire, areaStatus } = normalized;
    const result = await runTeamTool(tool, { member: active.member, apiKeyId: null, chatSessionId: chat.id, base: '' }, wire);
    return result.ok ? { ok: true, action: name, result: teamContentResult(result.result, areaStatus) }
      : { ok: false, action: name, error: { code: result.error.code, message: result.error.message } };
  }
  if (name === 'list_homes' && chat.surfaceKind !== 'result_review') {
    const home = q.getHome()!;
    return { ok: true, action: name, result: { bound_home: { id: home.id, name: home.name, kind: home.kind }, connected_homes: [] } };
  }
  const native = nativeTeamTools(active.turn.id, active.member.id).find(tool => tool.name === name);
  return native ? await native.run(raw) as DispatchEnvelope : refuse('This action is not available to a Team agent.');
}

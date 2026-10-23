/** Additive native tools. External member clients retain TEAM_TOOLS only. */
import * as q from '@/lib/db/queries';
import type { RequestKey } from '@/lib/auth/request-key';
import { withExecutionRequest } from '@/lib/home/execution-request';
import { findAction, runAction } from '@/lib/orchestrator/dispatch';
import type { ActionContext } from '@/lib/orchestrator/types';

const NATIVE_ACTIONS = ['list_workspaces', 'get_workspace', 'start_execution', 'get_handoff_context', 'report_result', 'get_result', 'list_results', 'request_result_review', 'report_result_review'] as const;

export function nativeTeamTools(turnId: string, memberId: string) {
  const caller = () => {
    const active = q.activeTeamChatTurnById(turnId, memberId);
    const chat = active ? q.getTeamChat(active.turn.chatSessionId) : null;
    const member = active?.turn.requestingApiKeyId ? q.memberForApiKey(active.turn.requestingApiKeyId) : null;
    const workspace = chat?.workspaceId ? q.getWorkspace(chat.workspaceId) : null;
    if (!active || !chat || !workspace || member?.id !== memberId) return null;
    const key: RequestKey = { scope: 'team_ai', location: 'elsewhere', apiKeyId: active.turn.requestingApiKeyId!, memberId,
      memberRole: member.role, workerDeviceId: null, sessionChatId: chat.id };
    const context: ActionContext = { remote: true, actor: { source: 'ai', sessionId: chat.id, memberId, executionId: chat.executionId }, caller: { location: 'elsewhere', apiKeyId: key.apiKeyId } };
    return { key, context, chat };
  };
  const first = caller();
  if (!first) return [];
  const reviewer = first.chat.surfaceKind === 'result_review';
  return NATIVE_ACTIONS.filter(name => !reviewer || ['get_result', 'report_result_review'].includes(name)).map(name => {
    const action = findAction(name)!;
    return { ...action, async run(input: unknown) {
      const current = caller();
      if (!current) return { ok: false, action: name, error: { code: 'unsupported', message: 'This member turn is no longer active.' } };
      return withExecutionRequest(current.key, () => runAction(name, input, current.context));
    } };
  });
}

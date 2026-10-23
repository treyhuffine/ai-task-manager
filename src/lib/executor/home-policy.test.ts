import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import * as q from '@/lib/db/queries';
import { executionDispatchPolicy } from './home-policy';
import { buildSessionSpec } from './session-spec';
import { verifySessionCredential } from '@/lib/orchestrator/session-credential';
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
beforeEach(async () => { fixture = await createTeamExecutionFixture(); });
afterEach(async () => { await fixture.cleanup(); });
function turn() {
  const saved = q.createExecutionWithChat({ workspaceId: fixture.workspace.id, harness: 'codex', label: 'Shared work', surfaceKind: q.TEAM_CHAT_SURFACE, createdByMemberId: fixture.member.member.id });
  q.createPlacement({ executionId: saved.execution.id, deviceId: q.getHome()!.hostDeviceId, startReason: 'created', worktreePath: fixture.workspace.cwd });
  const accepted = q.acceptTeamChatSend({ chatId: saved.session.id, memberId: fixture.member.member.id, requestingApiKeyId: fixture.member.key.id, clientSendId: 'policy-member-send', text: 'Shared work' }); q.claimNextTeamChatTurn(saved.session.id);
  return { session: q.getChatSessionWithExecution(saved.session.id)!, turn: accepted.turn };
}
it('requires the saved message and requesting sign-in at the Home before dispatch and rechecks revocation', () => {
  const saved = turn(); const input = { actor: fixture.actor, teamTurnId: saved.turn.id, sourceEventId: saved.turn.messageEventId };
  expect(() => executionDispatchPolicy(saved.session, { actor: fixture.actor })).toThrow(/serialized/);
  expect(() => executionDispatchPolicy(saved.session, { ...input, sourceEventId: 'wrong' })).toThrow(/saved member message/);
  const policy = executionDispatchPolicy(saved.session, input);
  expect(policy).toMatchObject({ personalContext: false, teamTurnId: saved.turn.id, requestingMemberId: fixture.member.member.id });
  q.revokeApiKey(fixture.member.key.id, 'Signed out'); expect(() => policy.verify()).toThrow(/active member/);
});
it('uses one stable signed session identity whose member is resolved from each serialized turn', async () => {
  const saved = turn();
  const spec = await buildSessionSpec({ chatSessionId: saved.session.id, harness: 'codex', cwd: fixture.workspace.cwd, sessionType: 'execution', workspaceId: fixture.workspace.id, surfaceKind: q.TEAM_CHAT_SURFACE, surfaceRef: null, existingExternalSessionId: null, executionId: saved.session.executionId, permissionMode: 'ask', prePlanMode: null, model: 'gpt-6.1-sol', modelVariant: null, effort: null, teamTurnId: saved.turn.id });
  expect(spec.mcpServers.map(server => server.name)).toEqual(['ri_team']);
  const server = spec.mcpServers[0] as { headers: Record<string, string> };
  expect(verifySessionCredential(server.headers.Authorization.slice(7))).toBe(saved.session.id);
  expect(spec.standingInstructions).toContain('Shared standing instructions.');
  expect(spec.env.RI_HOME_TOOLS_URL).toMatch(/^https?:\/\//);
  expect(spec.instructions).not.toMatch(/personal tasks|personal notes|private planning data/);
});

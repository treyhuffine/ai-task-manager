/** Prompt policy is shared across direct dispatch and member HTTP controls. */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import * as q from '@/lib/db/queries';
import { authorizeTeamActorExecution, authorizeTeamExecution } from '@/lib/home/execution-authority';
import type { RequestKey } from '@/lib/auth/request-key';
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
beforeEach(async () => { fixture = await createTeamExecutionFixture(); });
afterEach(async () => { await fixture.cleanup(); });
it.each(['answer', 'approve'] as const)('allows another active person to %s, and refuses agents, session identities and client keys', operation => {
  const chat = q.createChatSession({ harness: 'codex', type: 'orchestration', workspaceId: fixture.workspace.id, surfaceKind: q.TEAM_CHAT_SURFACE });
  q.acceptTeamChatSend({ chatId: chat.id, memberId: fixture.owner.member.id, requestingApiKeyId: fixture.owner.key.id, clientSendId: 'owner-prompt', text: 'Shared work' }); const turn = q.claimNextTeamChatTurn(chat.id)!;
  const input = { operation, chatId: chat.id, turnId: turn.id };
  expect(authorizeTeamActorExecution(fixture.actor, input).member.id).toBe(fixture.member.member.id);
  for (const actor of [{ ...fixture.actor, source: 'ai' as const }, { ...fixture.actor, sessionId: chat.id }, { source: 'system' as const }]) expect(() => authorizeTeamActorExecution(actor, input)).toThrow();
  const key: RequestKey = { ...fixture.actor, scope: 'member', location: 'elsewhere', workerDeviceId: null, sessionChatId: null };
  expect(authorizeTeamExecution(key, input).member.id).toBe(fixture.member.member.id);
  for (const scope of ['team_ai', 'session', 'ai_client'] as const) expect(() => authorizeTeamExecution({ ...key, scope }, input)).toThrow();
  q.removeMember(fixture.member.member.id); expect(() => authorizeTeamActorExecution(fixture.actor, input)).toThrow();
});

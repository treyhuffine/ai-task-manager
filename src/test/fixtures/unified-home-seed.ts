/** Reproducible W00 data matrix. Only the disposable Team process imports this. */
import * as q from '@/lib/db/queries';
import { TASK_STATUSES } from '@/lib/tasks/lifecycle';

export function seedUnifiedTeam(ownerId: string) {
  if (process.env.NODE_ENV !== 'test') throw new Error('Unified acceptance data belongs in a disposable test Home.');
  const grant = q.createTeamGrant({ kind: 'invite', role: 'member', createdByMemberId: ownerId });
  const member = q.redeemTeamInvite({ secret: grant.secret, name: 'Maya', device: { kind: 'computer', name: 'Acceptance browser' } });
  const area = q.createArea({ name: 'Engineering' });
  const tasks = TASK_STATUSES.map((status, index) => q.createTask({
    title: 'Same name', rawInput: 'Same name', body: `Shared ${status} context`, status,
    areaId: area.id, assigneeMemberId: index % 3 === 0 ? ownerId : index % 3 === 1 ? member.member.id : null,
    sortKey: status === 'todo' ? 'a0' : null,
  }));
  const note = q.createNote({ title: 'Same name', body: 'Shared reference', areaId: area.id });
  const chat = q.createChatSession({ harness: 'claude', type: 'orchestration', surfaceKind: q.TEAM_CHAT_SURFACE, label: 'Existing shared history' });
  q.insertChatEvent({ sessionId: chat.id, role: 'user', source: 'user', content: 'Earlier owner question', authorMemberId: ownerId });
  q.insertChatEvent({ sessionId: chat.id, role: 'user', source: 'user', content: 'Earlier member context', authorMemberId: member.member.id });
  q.insertChatEvent({ sessionId: chat.id, role: 'assistant', source: 'agent', content: 'Retained shared answer' });
  const client = q.createMemberAiClient(member.member.id, 'Existing MCP client');
  return {
    memberId: member.member.id, memberToken: member.token.plaintext,
    areaId: area.id, tasks: tasks.map(({ id, status, assigneeMemberId }) => ({ id, status, assigneeMemberId })),
    noteId: note.id, chatId: chat.id, mcpKeyId: client.client.keyId,
  };
}

export type UnifiedTeamSeed = ReturnType<typeof seedUnifiedTeam>;

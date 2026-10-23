import { expect, it } from 'vitest';
import type { EntityVersionRecord } from '@/db/types';
import { groupVersions } from './use-entity-versions';

function version(id: string, member: string | null, session: string | null = null): EntityVersionRecord {
  return { id, createdAt: '2026-10-19', updatedAt: '2026-10-19', entityType: 'task', entityId: 'task', source: session ? 'ai' : 'human', actorMemberId: member, actorSessionId: session, snapshot: { title: id, body: '' }, summary: null, revertedFromVersionId: null };
}

it('keeps different members and AI turns separate when reviewing or undoing changes', () => {
  const groups = groupVersions([version('4', 'one'), version('3', 'one'), version('2', 'two'), version('1', 'one')]);
  expect(groups.map((g) => g.count)).toEqual([2, 1, 1]);
  expect(groups[0].before?.id).toBe('2');
  expect(groupVersions([version('b', 'one', 'chat-b'), version('a', 'one', 'chat-a')])).toHaveLength(2);
});

it('preserves consecutive personal edits as one reviewable group', () => {
  expect(groupVersions([version('2', null), version('1', null)]).map((g) => g.count)).toEqual([2]);
});

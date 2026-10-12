import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
let home: TestHome;
beforeEach(async () => { home = await createTestHome(); });
afterEach(async () => { await home.cleanup(); });

it('never lets generic task or note writes manufacture a shared reference', async () => {
  const q = await import('@/lib/db/queries');
  q.saveTeamConnection({ id: 'team-123', name: 'Team', address: 'https://team.test', memberId: 'member', memberName: 'Me', role: 'member' });
  const source = { sourceTeamId: 'team-123', sourceState: 'active' as const };
  const task = q.createTask({ title: 'Private task', rawInput: 'Private task' });
  const note = q.createNote({ title: 'Private note', body: 'Private text' });
  expect(() => q.updateTask(task.id, { ...source, sourceTaskId: 'remote-task' }, { source: 'human' })).toThrow(/source|projection|reference/i);
  expect(() => q.updateNote(note.id, { ...source, sourceNoteId: 'remote-note' }, { source: 'human' })).toThrow(/source|projection|reference/i);
  expect(() => q.createTask({ title: 'Forged', rawInput: 'Forged', ...source, sourceTaskId: 'other' })).toThrow(/source|projection|reference/i);
  expect(() => q.createNote({ body: 'Forged', ...source, sourceNoteId: 'other' })).toThrow(/source|projection|reference/i);
});

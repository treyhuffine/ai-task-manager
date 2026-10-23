import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startTeamProcess, type TeamProcess } from '@/test/fixtures/team-process';
import { TASK_STATUSES } from '@/lib/tasks/lifecycle';
import * as q from '@/lib/db/queries';
import { teamTRPC } from './remote';
import { connectTeam } from './connect';
import { addTeamTaskToMyWork, saveTeamNoteToMyNotes, syncTeam } from './sync';

let home: TestHome;
let team: TeamProcess;
let root: string;
beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-unified-matrix-team-'));
  team = await startTeamProcess(root, 'Team Huffine', 'Owner', { unified: true });
  home = await createTestHome({ prefix: 'ri-unified-matrix-personal-' });
}, 90_000);
afterAll(async () => {
  await home?.cleanup(); await team?.stop();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

it('keeps a populated AI-off Team canonical while one existing member privately organizes references', async () => {
  const seed = team.fixture!;
  const owner = teamTRPC(team.url, team.ownerToken);
  const member = teamTRPC(team.url, seed.memberToken);
  const membersBefore = await owner.team.members.query();
  const keysBefore = await member.team.aiClients.list.query();
  expect(membersBefore).toHaveLength(2);
  expect(keysBefore.map(key => key.keyId)).toContain(seed.mcpKeyId);
  expect(seed.tasks.map(task => task.status)).toEqual([...TASK_STATUSES]);
  expect(new Set(seed.tasks.map(task => task.assigneeMemberId))).toEqual(new Set([team.ownerId, seed.memberId, null]));

  const connection = await connectTeam({ link: (await member.team.signIns.create.mutate()).link });
  expect(connection.memberId).toBe(seed.memberId);
  expect((await syncTeam(connection.id)).ok).toBe(true);
  const assigned = seed.tasks.find(task => task.status === 'todo')!;
  const imported = q.getTaskProjection(connection.id, assigned.id)!;
  expect(imported).toMatchObject({ sourceTaskId: assigned.id, sortKey: null, areaId: null });
  const mine = q.createArea({ name: 'My priorities' });
  q.updateTask(imported.id, { areaId: mine.id, sortKey: 'a1', userContext: 'Private planning' }, { source: 'human' });
  const unassigned = seed.tasks.find(task => task.assigneeMemberId === null)!;
  const included = await addTeamTaskToMyWork(connection.id, unassigned.id);
  expect((await addTeamTaskToMyWork(connection.id, unassigned.id)).id).toBe(included.id);
  const saved = await saveTeamNoteToMyNotes(connection.id, seed.noteId);
  expect((await saveTeamNoteToMyNotes(connection.id, seed.noteId)).id).toBe(saved.id);
  q.createTask({ title: 'Same name', rawInput: 'Same name' });
  q.createNote({ title: 'Same name', body: 'Private reference' });
  const privateChat = q.createChatSession({ harness: 'codex', type: 'orchestration', label: 'Private planning' });
  q.insertChatEvent({ sessionId: privateChat.id, role: 'user', source: 'user', content: 'Private conversation' });

  expect((await syncTeam(connection.id)).ok).toBe(true);
  expect(q.getTaskProjection(connection.id, assigned.id)).toMatchObject({ id: imported.id, areaId: mine.id, sortKey: 'a1', userContext: 'Private planning', source: { area: { id: seed.areaId, name: 'Engineering' } } });
  expect(await owner.tasks.get.query({ id: assigned.id })).toMatchObject({ areaId: seed.areaId, sortKey: 'a0' });
  expect(await owner.team.members.query()).toEqual(membersBefore);
  expect(await member.team.aiClients.list.query()).toEqual(keysBefore);
  const history = await member.team.ai.events.query({ chatId: seed.chatId });
  expect(history.events.map(event => event.content)).toEqual(['Earlier owner question', 'Earlier member context', 'Retained shared answer']);
  expect(history.events.slice(0, 2).map(event => event.authorMemberId)).toEqual([team.ownerId, seed.memberId]);
  expect(q.listAreas({ status: 'all' }).map(area => area.id)).toEqual([mine.id]);
}, 60_000);

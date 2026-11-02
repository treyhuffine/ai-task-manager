import { afterEach, expect, it, vi } from 'vitest';
import type { TaskListDTO } from '@/lib/api/dto/entity-list';
import { groupTaskList, placeInTaskGroup, readTaskListPreferences } from './list-groups';

const task = (id: string, fields: Partial<TaskListDTO> = {}) => ({ id, status: 'todo', sortKey: null, createdAt: '2026-11-02', areaId: null, assigneeMemberId: null, ...fields }) as TaskListDTO;
afterEach(() => vi.unstubAllGlobals());

it('uses lifecycle order while keeping the selected server sort within groups', () => {
  const tasks = [task('done', { status: 'done' }), task('due-today'), task('working', { status: 'in_progress' }), task('undated'), task('idea', { status: 'consider' })];
  const groups = groupTaskList(tasks, 'status', new Map(), new Map());
  expect(groups.map(group => group.label)).toEqual(['In progress', 'Todo', 'Consider', 'Done']);
  expect(groups[1].tasks.map(task => task.id)).toEqual(['due-today', 'undated']);
  expect(groupTaskList(tasks, 'none', new Map(), new Map())[0].tasks).toEqual(tasks);
});

it('orders named groups alphabetically and keeps unassigned and unfiled tasks last', () => {
  const tasks = [task('empty'), task('z', { assigneeMemberId: 'z', areaId: 'z' }), task('a', { assigneeMemberId: 'a', areaId: 'a' })];
  expect(groupTaskList(tasks, 'assignee', new Map(), new Map([['a', 'Alice'], ['z', 'Zoe']])).map(group => group.label)).toEqual(['Alice', 'Zoe', 'Unassigned']);
  expect(groupTaskList(tasks, 'area', new Map([['a', 'Design'], ['z', 'Launch']]), new Map()).map(group => group.label)).toEqual(['Design', 'Launch', 'No area']);
});

it('moves within a group without changing fields or other tasks relative order, then supports flattening', () => {
  const tasks = [task('first', { sortKey: 'a0' }), task('other-group', { sortKey: 'a1', status: 'in_progress' }), task('second', { sortKey: 'a2' }), task('last')];
  const placement = placeInTaskGroup(tasks, 'second', 1, 'status')!;
  expect(placement.list.map(task => task.id)).toEqual(['second', 'first', 'other-group', 'last']);
  expect(placement.writes).toHaveLength(1);
  expect(placement.list.find(task => task.id === 'second')?.status).toBe('todo');
  const flattened = placeInTaskGroup(placement.list, 'last', 2, 'none')!;
  expect(flattened.list.map(task => task.id)).toEqual(['second', 'last', 'first', 'other-group']);
  expect(new Set(flattened.list.map(task => task.sortKey)).size).toBe(flattened.list.length);
});

it('places priority buckets using priority order even when input is sorted by deadline', () => {
  const tasks = [task('second', { sortKey: 'a2' }), task('first', { sortKey: 'a0' }), task('other-group', { sortKey: 'a1', status: 'done' })];
  const placement = placeInTaskGroup(tasks, 'first', 2, 'status')!;
  expect(placement.list.filter(task => task.status === 'todo').map(task => task.id)).toEqual(['second', 'first']);
  expect(placement.writes.map(write => write.id)).toEqual(['first']);
});

it('keeps personal defaults and safely restores each Team list preference', () => {
  expect(readTaskListPreferences(undefined, true)).toEqual({ sort: 'sortKey', group: 'none' });
  expect(readTaskListPreferences(undefined, false)).toEqual({ sort: 'hardDeadline', group: 'status' });
  vi.stubGlobal('window', {});
  const storage = new Map([['team-a:maya', '{"sort":"updatedAt","group":"assignee"}'], ['broken', '{']]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null });
  expect(readTaskListPreferences('team-a:maya', false)).toEqual({ sort: 'updatedAt', group: 'assignee' });
  expect(readTaskListPreferences('team-a:luis', false)).toEqual({ sort: 'hardDeadline', group: 'status' });
  expect(readTaskListPreferences('broken', false)).toEqual({ sort: 'hardDeadline', group: 'status' });
});

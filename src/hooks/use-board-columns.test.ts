import { expect, it } from 'vitest';
import { parseBoardColumns, revealedColumns } from './use-board-columns';
const order = ['consider', 'todo', 'current', 'done', 'archived'] as const;
const defaults = ['consider', 'todo', 'current'] as const;
it('uses unfinished defaults and restores explicit choices including Done and Archived', () => {
  expect(parseBoardColumns(null, order, defaults)).toEqual(defaults);
  expect(parseBoardColumns('["archived","done","todo","unknown"]', order, defaults)).toEqual(['todo', 'done', 'archived']);
  expect(parseBoardColumns('[]', order, defaults)).toEqual([]);
  expect(parseBoardColumns('broken', order, defaults)).toEqual(defaults);
  expect(parseBoardColumns('[true]', order, defaults)).toEqual(defaults);
});
it('reveals a HUD target in canonical order without changing saved preferences', () => {
  const saved = ['working'] as const;
  const order = ['needsApproval', 'unread', 'working', 'waiting'] as const;
  expect(revealedColumns(order, saved, 'needsApproval')).toEqual(['needsApproval', 'working']);
  expect(saved).toEqual(['working']);
  expect(revealedColumns(order, saved, null)).toEqual(['working']);
  expect(revealedColumns(order, [], 'unread')).toEqual(['unread']);
});

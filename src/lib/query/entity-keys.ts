import type { QueryKey, QueryFilters } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc/client';
import type { TaskFilter } from '@/db/types';

export type EntityRoot = 'tasks' | 'notes' | 'areas';
export const entityKeys = {
  tasks: { all: trpc.tasks.pathKey(), list: trpc.tasks.list.queryKey, detail: (id: string) => trpc.tasks.get.queryKey({ id }) },
  notes: { all: trpc.notes.pathKey(), list: trpc.notes.list.queryKey, detail: (id: string) => trpc.notes.get.queryKey({ id }) },
  areas: { all: trpc.areas.pathKey(), list: trpc.areas.list.queryKey, detail: (id: string) => trpc.areas.get.queryKey({ id }) },
};

/** Key-shape knowledge stays here. Never infer "list" from an array result:
 * tasks.deadlines/executions are arrays too, with different row contracts. */
export function isEntityProcedureKey(key: QueryKey, root: EntityRoot, procedure: 'list' | 'get'): boolean {
  const prefix = procedure === 'list' ? entityKeys[root].list() : entityKeys[root].detail('');
  const expected = prefix[0];
  const path = key[0];
  return Array.isArray(path) && Array.isArray(expected) && path.length === expected.length && path.every((part, i) => part === expected[i]);
}
export function taskListFilter(key: QueryKey): TaskFilter | undefined {
  if (!isEntityProcedureKey(key, 'tasks', 'list')) return undefined;
  const options = key[1] as { input?: TaskFilter } | undefined;
  return options?.input;
}

export function entityQueryFilter(root: EntityRoot): QueryFilters {
  return {
    queryKey: entityKeys[root].all,
    predicate: (q) => isEntityProcedureKey(q.queryKey, root, 'get') || isEntityProcedureKey(q.queryKey, root, 'list'),
  };
}

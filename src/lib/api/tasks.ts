import { trpcClient } from '@/lib/trpc/client';
import type { RouterInputs, RouterOutputs } from '@/lib/trpc/router';
import type { TransitionCommand } from '@/lib/tasks/lifecycle';

export type LifecycleResult = RouterOutputs['tasks']['complete'];
type Input = RouterInputs['tasks'];
/** Imperative calls (drag/drop, confirmation loops) share the typed transport.
 * Hooks use tRPC query options, so cache keys and outputs stay server-derived. */
export const tasksApi = {
  list: (filter?: Input['list']) => trpcClient.tasks.list.query(filter),
  get: (id: string) => trpcClient.tasks.get.query({ id }),
  create: (input: Input['create']) => trpcClient.tasks.create.mutate(input),
  update: (id: string, patch: Input['update']['patch']) => trpcClient.tasks.update.mutate({ id, patch }),
  delete: (id: string) => trpcClient.tasks.delete.mutate({ id }),
  complete: (id: string, opts: Omit<Input['complete'], 'id'> = {}) => trpcClient.tasks.complete.mutate({ id, ...opts }),
  transition: (id: string, command: TransitionCommand, opts: Omit<Input['transition'], 'id' | 'command'> = {}) => trpcClient.tasks.transition.mutate({ id, command, ...opts }),
  executions: (id: string) => trpcClient.tasks.executions.query({ id }),
  reorder: (id: string, opts: Omit<Input['reorder'], 'id'>) => trpcClient.tasks.reorder.mutate({ id, ...opts }),
  attention: async (ids: string[]) => {
    const unique = [...new Set(ids)];
    const batches: Promise<RouterOutputs['tasks']['attention']>[] = [];
    for (let start = 0; start < unique.length; start += 200) {
      batches.push(trpcClient.tasks.attention.query({ ids: unique.slice(start, start + 200) }));
    }
    const result: RouterOutputs['tasks']['attention'] = {};
    for (const batch of await Promise.all(batches)) Object.assign(result, batch);
    return result;
  },
  counts: (areaId?: string | null) => trpcClient.tasks.counts.query({ areaId }),
  deadlines: (withinDays?: number) => trpcClient.tasks.deadlines.query({ withinDays }),
};

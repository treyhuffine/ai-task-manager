import { trpcClient } from '@/lib/trpc/client';
import type { RouterInputs } from '@/lib/trpc/router';
type Input = RouterInputs['notes'];

export const notesApi = {
  list: (filter?: Input['list']) => trpcClient.notes.list.query(filter),
  get: (id: string) => trpcClient.notes.get.query({ id }),
  create: (input: Input['create']) => trpcClient.notes.create.mutate(input),
  update: (id: string, patch: Input['update']['patch']) => trpcClient.notes.update.mutate({ id, patch }),
  delete: (id: string) => trpcClient.notes.delete.mutate({ id }),
};

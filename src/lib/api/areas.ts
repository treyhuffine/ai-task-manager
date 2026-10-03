import { trpcClient } from '@/lib/trpc/client';
import type { RouterInputs } from '@/lib/trpc/router';
type Input = RouterInputs['areas'];

export const areasApi = {
  list: (filter?: Input['list']) => trpcClient.areas.list.query(filter),
  get: (id: string) => trpcClient.areas.get.query({ id }),
  create: (input: Input['create']) => trpcClient.areas.create.mutate(input),
  update: (id: string, patch: Input['update']['patch']) => trpcClient.areas.update.mutate({ id, patch }),
};

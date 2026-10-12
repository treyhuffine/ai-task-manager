import { QueryClient } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import { entityKeys } from '@/lib/query/entity-keys';
import { trpc } from '@/lib/trpc/client';
import { invalidateTeamContent, teamConnectionsKey } from './client-cache';

it('refreshes notes, tasks and the same connections query used by Settings', () => {
  const client = new QueryClient();
  const keys = [entityKeys.tasks.detail('task'), entityKeys.notes.detail('note'), trpc.spaces.list.queryKey()];
  for (const key of keys) client.setQueryData<unknown>(key, { cached: true });
  expect(teamConnectionsKey()).toEqual(trpc.spaces.list.queryKey());
  invalidateTeamContent(client);
  for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  client.clear();
});

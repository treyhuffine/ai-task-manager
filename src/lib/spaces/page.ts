/**
 * Which team a page request shows inside My Ri, read on the server
 * (docs/homes-spec.md §3.2, P7.1). The proxy sets the header only for
 * `/space/<team>` pages, never from the request.
 */

import { headers } from 'next/headers';
import { getTeamConnection } from '@/lib/db/queries';
import type { TeamConnectionStatus } from '@/db/types';
import { SPACE_HEADER, SPACE_ID_PATTERN } from './document';

export interface SpacePage {
  id: string;
  /** The team's name, or null when this Ri isn't connected to it. */
  name: string | null;
  status: TeamConnectionStatus | null;
}

export async function spacePage(): Promise<SpacePage | null> {
  const id = (await headers()).get(SPACE_HEADER);
  if (!id || !SPACE_ID_PATTERN.test(id)) return null;
  const connection = getTeamConnection(id);
  return { id, name: connection?.name ?? null, status: connection?.status ?? null };
}

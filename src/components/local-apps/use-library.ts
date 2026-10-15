'use client';

import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc/client';
import { useSkills } from '@/hooks/use-skills';

/** Existing registries remain the source of truth. A failure in one does not hide the others. */
export function useLibrary() {
  const providers = useQuery(trpc.integrations.statusGet.queryOptions({}, { staleTime: 10_000 }));
  const connections = useQuery(trpc.integrations.connectionsGet.queryOptions({}, { staleTime: 10_000 }));
  const servers = useQuery(trpc.integrations.mcpServersGet.queryOptions({}, { staleTime: 10_000 }));
  const skills = useSkills();
  return { providers, connections, servers, skills };
}

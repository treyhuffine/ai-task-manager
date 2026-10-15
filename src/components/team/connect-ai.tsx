'use client';

import { useQuery } from '@tanstack/react-query';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { apiErrorText } from '@/lib/api/client';
import { ExternalAssistants } from '@/components/settings/external-assistants';
import { useTeam } from './team-context';

export function ConnectAiSection() {
  const { team } = useTeam();
  const clients = useQuery(trpc.team.aiClients.list.queryOptions());
  return <ExternalAssistants
    space={{ kind: 'team', name: team.name }} clients={clients.data ?? []} ready={clients.isSuccess}
    createClient={name => trpcClient.team.aiClients.create.mutate({ name })}
    revokeClient={keyId => trpcClient.team.aiClients.revoke.mutate({ keyId })}
    onChanged={() => void clients.refetch()}
  >
    {clients.isError && <p role="alert" className="mt-2 text-xs text-destructive">{apiErrorText(clients.error)} <button onClick={() => void clients.refetch()} className="underline">Retry</button></p>}
  </ExternalAssistants>;
}

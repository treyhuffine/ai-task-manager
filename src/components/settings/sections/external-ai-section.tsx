'use client';

import { useQuery } from '@tanstack/react-query';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { apiErrorText } from '@/lib/api/client';
import { AgentSkillAccess } from '../agent-skill-access';
import { ExternalAssistants } from '../external-assistants';
import { setSettingsSection } from '../settings-store';

/**
 * Two ways in from outside Ri: the coding tools on this computer, through
 * Ri's user-level skills, and any assistant anywhere, through a keyed MCP
 * connection.
 */
export function ExternalAiSection() {
  const clients = useQuery(trpc.externalAi.list.queryOptions());
  const address = useQuery(trpc.externalAi.address.queryOptions());
  return <div className="space-y-6">
    <AgentSkillAccess />
    <ExternalAssistants
      space={{ kind: 'personal', name: 'Home' }} clients={clients.data ?? []}
      ready={clients.isSuccess && address.isSuccess}
      createClient={name => trpcClient.externalAi.create.mutate({ name })}
      revokeClient={keyId => trpcClient.externalAi.revoke.mutate({ keyId })}
      onChanged={() => void clients.refetch()}
    >
      <p className="mt-2 text-xs text-muted-foreground">This gives access to your personal work, including private notes. It does not start Ri chats or give access to settings, terminals or your computer’s files.</p>
      <div className="my-3 rounded-md border border-border p-3 text-xs">
        {address.data?.reachable ? <>
          <p>Uses your Home’s remote address. The computer hosting it must stay on and reachable.</p>
          <p className="mt-1 break-all font-mono text-muted-foreground">{address.data.mcpUrl}</p>
        </> : <p>To connect an assistant on another computer, first set your Home’s remote address. Without one, these instructions work on the computer hosting Ri.</p>}
        <button type="button" className="mt-2 underline" onClick={() => setSettingsSection('devices')}>Remote access in Devices</button>
      </div>
      {(clients.isError || address.isError) && <p role="alert" className="mb-2 text-xs text-destructive">
        {apiErrorText(clients.error ?? address.error)}{' '}
        <button type="button" className="underline" onClick={() => { void clients.refetch(); void address.refetch(); }}>Retry</button>
      </p>}
    </ExternalAssistants>
  </div>;
}

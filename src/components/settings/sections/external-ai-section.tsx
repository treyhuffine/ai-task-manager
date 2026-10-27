'use client';

import { useQuery } from '@tanstack/react-query';
import { APP_NAME } from '@/constants/app';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { apiErrorText } from '@/lib/api/client';
import type { AiConnectionTarget } from '@/lib/external-ai/client-config';
import { AgentSkillFooter } from '../agent-skill-access';
import { ConnectAgents } from '../connect-agents';
import { setSettingsSection } from '../settings-store';

/**
 * Settings → Connect your agent, for a personal Ri: every outside agent's
 * steps, one-click Set up for the agents on the computer running Ri, and Ri's
 * skills for agents there (docs/external-ai.md).
 */
export function ExternalAiSection() {
  const keys = useQuery(trpc.externalAi.list.queryOptions());
  const address = useQuery(trpc.externalAi.address.queryOptions());
  const local = useQuery(trpc.externalAi.local.queryOptions());
  const refresh = () => { void keys.refetch(); void local.refetch(); };
  const target: AiConnectionTarget | null = address.data
    ? { space: { kind: 'personal' }, mcpUrl: address.data.mcpUrl, server: address.data.server, tokenVar: address.data.tokenVar }
    : null;

  return (
    <div className="space-y-6">
      <ConnectAgents
        target={target}
        keys={keys.data ?? []}
        ready={keys.isSuccess && address.isSuccess}
        createKey={client => trpcClient.externalAi.create.mutate({ client })}
        revokeKey={keyId => trpcClient.externalAi.revoke.mutate({ keyId })}
        onChanged={refresh}
        local={{
          device: local.data?.device ?? null,
          agents: local.data?.agents,
          loading: local.isPending,
          setUp: client => trpcClient.externalAi.setUp.mutate({ client }),
          disconnect: client => trpcClient.externalAi.disconnectLocal.mutate({ client }),
        }}
      >
        <p className="text-xs text-muted-foreground">
          {`Connected agents can search, read and update your tasks, notes, areas and deck, private notes included, with their own model. They can’t start ${APP_NAME} chats, change settings or reach this computer’s files. Each agent gets its own key, and you can disconnect it here any time.`}
        </p>
        <div className="rounded-md border border-border p-3 text-xs">
          {address.data?.reachable ? <>
            <p>Agents on other computers use your remote address. The computer running {APP_NAME} must stay on and reachable.</p>
            <p className="mt-1 break-all font-mono text-muted-foreground">{address.data.mcpUrl}</p>
          </> : <p>Agents on this computer connect without anything else. To connect one on another computer, set a remote address first.</p>}
          <button type="button" className="mt-2 underline" onClick={() => setSettingsSection('devices')}>Remote access in Devices</button>
        </div>
        {(keys.isError || address.isError || local.isError) && <p role="alert" className="text-xs text-destructive">
          {apiErrorText(keys.error ?? address.error ?? local.error)}{' '}
          <button type="button" className="underline" onClick={() => { refresh(); void address.refetch(); }}>Retry</button>
        </p>}
      </ConnectAgents>
      <AgentSkillFooter />
    </div>
  );
}

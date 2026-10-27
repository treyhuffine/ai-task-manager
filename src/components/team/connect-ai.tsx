'use client';

import { useQuery } from '@tanstack/react-query';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { apiErrorText } from '@/lib/api/client';
import { teamConnectionTarget } from '@/lib/external-ai/client-config';
import { ConnectAgents } from '@/components/settings/connect-agents';
import { useTeam } from './team-context';

/**
 * A team's Settings → Connect your agent: the same list as a personal Ri's,
 * with the team's address and names and the member's own keys. Set up on
 * this computer belongs to a personal Ri, which runs on the member's own
 * computer, so a team lists the steps, links and setup prompt.
 */
export function ConnectAiSection() {
  const { team, member } = useTeam();
  const keys = useQuery(trpc.team.aiClients.list.queryOptions());
  const address = useQuery(trpc.team.aiClients.address.queryOptions());
  return <ConnectAgents
    target={address.data ? teamConnectionTarget(team.name, address.data.mcpUrl) : null}
    keys={keys.data ?? []}
    ready={keys.isSuccess && address.isSuccess}
    createKey={client => trpcClient.team.aiClients.create.mutate({ client })}
    revokeKey={keyId => trpcClient.team.aiClients.revoke.mutate({ keyId })}
    onChanged={() => void keys.refetch()}
  >
    <p className="text-xs text-muted-foreground">Connected agents work on {team.name}’s shared tasks, notes and decisions as {member.name}, with their own model, using your existing membership. Connecting one doesn’t add a member or start chats on the team’s computer. For shared chats inside the team, use AI &amp; Models.</p>
    {address.data && !address.data.reachable && <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">Until the team has an address people can reach, these steps work only on the computer hosting it. Its owner sets one in Settings.</p>}
    {(keys.isError || address.isError) && <p role="alert" className="text-xs text-destructive">{apiErrorText(keys.error ?? address.error)} <button type="button" onClick={() => { void keys.refetch(); void address.refetch(); }} className="underline">Retry</button></p>}
  </ConnectAgents>;
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { APP_ANCHOR } from '@/components/settings/sections/plugins/navigation';
import type { AccountNeedingYou } from '@/lib/integrations/attention';
import { trpc } from '@/lib/trpc/client';

/**
 * The connected accounts only you can fix (`src/lib/integrations/attention.ts`),
 * for the rail's Connect accounts. Read once a minute while the page is shown,
 * and on focus, since an account can stop working in the middle of an agent's
 * run. Reconnecting in Settings refreshes it with the rest of `integrations`.
 */
export function useAccountsNeedingYou(): AccountNeedingYou[] {
  const { data } = useQuery(trpc.integrations.attentionGet.queryOptions(undefined, { staleTime: 30_000, refetchInterval: 60_000 }));
  return data ?? [];
}

/** Where Connect accounts lands: the one page that fixes them all, or else the list that marks each. */
export function connectAccountsAnchor(accounts: readonly AccountNeedingYou[]): string {
  const targets = new Map(accounts.map((account) => [`${account.target.kind}:${account.target.id}`, account.target]));
  if (targets.size === 1) {
    const [target] = targets.values();
    if (target!.kind === 'server') return `mcp:${target!.id}`;
    if (target!.kind === 'application') return `${APP_ANCHOR}${target!.id}`;
    return `integrations:${target!.id}`;
  }
  return accounts.length > 0 && accounts.every((account) => account.target.kind === 'server') ? 'mcp' : 'integrations';
}

/** Which accounts, in Connectors' words: "Reconnect Gmail (Work) and Todoist". */
export function reconnectLabel(accounts: readonly AccountNeedingYou[]): string | undefined {
  if (accounts.length === 0) return undefined;
  const names = accounts.map((account) => (account.account ? `${account.name} (${account.account})` : account.name));
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `Reconnect ${list}`;
}

'use client';

/**
 * What an MCP server's screens may reach on the network, on its connection
 * page (docs/connected-mcp-apps.md, "Security"). A screen reaches only the
 * domains its interface declared, so the person sees each one here. Nothing
 * renders for a server without screens, or one that isn't connected.
 */
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { GroupHeading } from './parts';

export interface AppNetwork { screens: number; read: number; connectDomains: string[]; resourceDomains: string[]; frameDomains: string[]; baseUriDomains: string[] }

const KINDS = [
  ['connectDomains', 'Exchange data with'],
  ['resourceDomains', 'Load code, styles, images and fonts from'],
  ['frameDomains', 'Show pages from'],
  ['baseUriDomains', 'Resolve links against'],
] as const;

export function McpAppNetwork({ serverId, name, enabled }: { serverId: string; name: string; enabled: boolean }) {
  return enabled ? <LoadedNetwork serverId={serverId} name={name} /> : null;
}

function LoadedNetwork({ serverId, name }: { serverId: string; name: string }) {
  const network = useQuery(trpc.connectedApps.network.queryOptions({ serverId }, { staleTime: 60_000, retry: false, refetchOnWindowFocus: false }));
  if (network.isError || network.data === null) return null;
  return <section aria-label={`Network access for ${name}`} className="space-y-2 rounded-xl border border-border bg-card/20 p-4">
    <GroupHeading>Network access</GroupHeading>
    {network.data ? <AppNetworkList network={network.data} name={name} />
      : <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" />Reading what {name}&apos;s screens declare…</p>}
  </section>;
}

/** The declared sites, by what a screen may do with them. Rendered alone in tests. */
export function AppNetworkList({ network, name }: { network: AppNetwork; name: string }) {
  const declared = KINDS.filter(([key]) => network[key].length > 0);
  const unread = network.screens - network.read;
  return <div className="space-y-2 text-xs">
    {declared.length === 0
      ? <p className="text-muted-foreground">{`${name}'s screens declare no sites, so they can't reach the network. They work only through Ri.`}</p>
      : <>
        <p className="text-muted-foreground">{`${name}'s screens may reach these sites, which they declared. They can reach nothing else.`}</p>
        <dl className="space-y-2">{declared.map(([key, label]) => <div key={key}>
          <dt className="font-medium">{label}</dt>
          <dd><ul className="mt-1 space-y-0.5">{network[key].map(domain => <li key={domain}><code className="break-all text-[11px]">{domain}</code></li>)}</ul></dd>
        </div>)}</dl>
      </>}
    {unread > 0 && <p className="text-muted-foreground">{`Ri couldn't read ${unread === 1 ? 'one of its screens' : `${unread} of its screens`} just now, so there may be more. This page checks again next time.`}</p>}
  </div>;
}

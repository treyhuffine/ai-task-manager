'use client';

import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Byo, type ProviderDetailProps } from './provider-detail';
import { providerForHostedAccount } from './hosted-account-request';

/** App credentials prepare sign-in. They are distinct from authorized Slack accounts. */
export function SlackAppsSection(props: ProviderDetailProps & { onConnectApp: (id: string) => void }) {
  const used = props.provider.mcp?.accounts?.flatMap(account => account.authConfigId ? [account.authConfigId] : []) ?? [];
  const adding = !props.provider.configured || props.advancedOpen;
  return <section aria-label="Slack apps" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">Slack apps</h3>
      {props.provider.configured && <Button size="xs" variant="outline" disabled={props.busy} onClick={props.onToggleAdvanced}><Plus size={12} />{adding ? 'Close app setup' : 'Add Slack app'}</Button>}
    </div>
    <p className="text-xs text-muted-foreground">An app lets Ri request access to Slack. Save its credentials, then connect the Slack account you want Ri to use.</p>
    {props.loadingApps && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" />Loading saved Slack apps…</p>}
    {props.byoConfigs.map(app => <div key={app.id} className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0"><p className="break-words text-sm font-medium">{app.label ?? app.id}</p><p className="text-xs text-muted-foreground">App saved{app.isDefault ? ' · Default app' : ''}</p></div>
        <div className="flex flex-wrap gap-1">
          <Button size="xs" variant="outline" disabled={props.busy || app.status !== 'active'} onClick={() => props.onConnectApp(app.id)}>Connect account</Button>
          {!app.isDefault && <Button size="xs" variant="ghost" disabled={props.busy} onClick={() => props.onByoSetDefault(app.id)}>Make default</Button>}
          <Button size="xs" variant="ghost" disabled={props.busy || used.includes(app.id)} onClick={() => props.onByoDelete(app.id)}>Remove app</Button>
        </div>
      </div>
      {props.savedApp?.id === app.id && !used.includes(app.id) && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">App saved. Next, connect your Slack account below.</p>}
    </div>)}
    {adding && <div className="rounded-xl border border-border p-4"><Byo {...props} provider={providerForHostedAccount(props.provider, {addAccount:true})} byoConfigs={[]} /></div>}
  </section>;
}

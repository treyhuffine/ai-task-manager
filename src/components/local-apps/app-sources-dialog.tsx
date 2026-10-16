'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Chip, GroupHeading } from '@/components/settings/sections/integrations/parts';
import { openSettings } from '@/components/settings/settings-store';
import { trpcClient } from '@/lib/trpc/client';
import { KEY } from './app-hooks';

type Choice = { granted: boolean; automatic: boolean };

/** What each requested Ri capability lets an app do, in the owner's words. */
const CAPABILITY_COPY: Record<string, { label: string; hint: string }> = {
  create_task: { label: 'Create Ri tasks you choose', hint: 'Only after you confirm a follow-up. It never completes or edits other tasks.' },
  get_task: { label: 'See the status of tasks it created', hint: 'Shows whether a linked task is still open.' },
  list_tasks: { label: 'List your Ri tasks', hint: 'Reads task titles and status.' },
  create_note: { label: 'Create Ri notes you choose', hint: 'Only after you confirm.' },
  get_note: { label: 'Read Ri notes it links to', hint: 'Reads a note you linked.' },
  list_notes: { label: 'List your Ri notes', hint: 'Reads note titles.' },
  extract_text: { label: 'Read text from files you choose', hint: 'PDF and Word files you select are read on this computer. Nothing is uploaded.' },
  ai_text: { label: 'Use bounded AI to read your sources', hint: 'Sends short, relevant passages to your Claude subscription with no tools. Results stay suggestions until you review them.' },
};

const key = (binding: string, connectionId: string) => `${binding}\u0000${connectionId}`;

/**
 * Sources and access for an installed app, in Ri's own chrome: which accounts
 * already connected to Ri the app may read, which of those update
 * automatically, and which Ri capabilities it may use. Connecting a new
 * account or reconnecting one goes to Ri's existing account settings.
 */
export function AppSourcesDialog({ instanceId, open, onOpenChange }: { instanceId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [...KEY, 'sources', instanceId],
    queryFn: () => trpcClient.localApps.sources.query({ id: instanceId }),
    enabled: open,
    refetchOnWindowFocus: true,
  });
  const data = query.data;
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [riActions, setRiActions] = useState<string[]>([]);
  const [background, setBackground] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Reset the edit whenever the saved settings change underneath it.
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const next: Record<string, Choice> = {};
      for (const account of data.accounts)
        for (const binding of account.bindings) next[key(binding.binding, account.id)] = { granted: binding.granted, automatic: binding.automatic };
      setChoices(next);
      setRiActions(data.riActions.filter((item) => item.owner).map((item) => item.name));
      setBackground(data.riActions.filter((item) => item.background).map((item) => item.name));
    });
    return () => { cancelled = true; };
  }, [data]);

  const providers = useMemo(() => [...new Set((data?.bindings ?? []).map((binding) => binding.providerId).filter(Boolean))] as string[], [data]);
  const automaticCount = Object.values(choices).filter((choice) => choice.granted && choice.automatic).length;

  async function save() {
    if (!data) return;
    setBusy(true);
    try {
      await trpcClient.localApps.configureSources.mutate({
        id: instanceId,
        revision: data.revision,
        accounts: Object.entries(choices).map(([joined, choice]) => {
          const [binding, connectionId] = joined.split('\u0000');
          return { binding, connectionId, granted: choice.granted, automatic: choice.granted && choice.automatic };
        }),
        riActions,
        backgroundRiActions: background.filter((name) => riActions.includes(name)),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      });
      await qc.invalidateQueries({ queryKey: KEY });
      toast.success('Sources saved');
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sources could not be saved');
      await query.refetch();
    } finally {
      setBusy(false);
    }
  }

  const connect = (providerId: string) => openSettings('plugins', { anchor: `integrations:${providerId}` });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{data?.displayName ?? 'App'} sources</DialogTitle>
          <DialogDescription>
            Choose which accounts connected to Ri this app may read, and which update automatically. The app can only read. It never sends, changes or deletes anything in these accounts.
          </DialogDescription>
        </DialogHeader>

        {query.isLoading && <p className="text-[12px] text-muted-foreground">Loading accounts</p>}
        {query.error && <p role="alert" className="text-[12px] text-destructive">{query.error.message}</p>}

        {data && (
          <div className="space-y-6">
            {data.disconnected > 0 && (
              <p role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-[12px] text-muted-foreground">
                {data.disconnected === 1 ? 'One account was' : `${data.disconnected} accounts were`} disconnected from Ri. Imported records stay in {data.displayName}. Save to stop listing {data.disconnected === 1 ? 'it' : 'them'} here.
              </p>
            )}
            {data.bindings.map((binding) => {
              const accounts = data.accounts.filter((account) => account.providerId === binding.providerId);
              return (
                <section key={binding.binding} className="space-y-2">
                  <GroupHeading count={accounts.length}>{binding.name}</GroupHeading>
                  {!binding.available && <p className="text-[12px] text-muted-foreground">{binding.name} is not available on this Home.</p>}
                  {binding.available && !accounts.length && (
                    <div className="rounded-lg border border-dashed border-border p-3 text-[12px] text-muted-foreground">
                      No account for {binding.name} is connected to Ri yet.
                      <Button variant="link" size="xs" className="ml-1 h-auto p-0 text-[12px]" onClick={() => connect(binding.providerId!)}>Connect an account in Ri</Button>
                    </div>
                  )}
                  <ul className="divide-y divide-border/60 rounded-lg border border-border">
                    {accounts.map((account) => {
                      const detail = account.bindings.find((item) => item.binding === binding.binding)!;
                      const choice = choices[key(binding.binding, account.id)] ?? { granted: false, automatic: false };
                      const reconnect = account.status !== 'active';
                      const set = (patch: Partial<Choice>) => setChoices((current) => ({ ...current, [key(binding.binding, account.id)]: { ...choice, ...patch } }));
                      return (
                        <li key={account.id} className="space-y-2 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{account.label}</span>
                            {reconnect ? <Chip tone="warn">Reconnect needed</Chip> : detail.needsConsent ? <Chip tone="warn">Needs {binding.name} permission</Chip> : <Chip>Connected to Ri</Chip>}
                            {(reconnect || detail.needsConsent) && (
                              <Button size="xs" variant="outline" onClick={() => connect(account.providerId)}>
                                <RefreshCw size={12} aria-hidden /> Reconnect
                              </Button>
                            )}
                          </div>
                          <label className="flex items-center gap-2 text-[12px] text-foreground/90">
                            <Checkbox checked={choice.granted} onCheckedChange={(value) => set({ granted: value === true, automatic: value === true ? choice.automatic : false })} aria-label={`Grant ${account.label} to ${data.displayName}`} />
                            Granted to {data.displayName}
                          </label>
                          {data.background.supported && (
                            <label className="flex items-center gap-2 text-[12px] text-foreground/90">
                              <Switch checked={choice.granted && choice.automatic} disabled={!choice.granted} onCheckedChange={(value) => set({ automatic: value })} aria-label={`Automatic updates for ${account.label}`} />
                              Automatic updates {choice.granted ? (choice.automatic ? 'on' : 'off') : 'need access first'}
                            </label>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
            {providers.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {providers.map((providerId) => (
                  <Button key={providerId} size="xs" variant="outline" onClick={() => connect(providerId)}>
                    Connect another {providerId === 'google' ? 'Google' : providerId} account
                  </Button>
                ))}
              </div>
            )}

            {!!data.riActions.length && (
              <section className="space-y-2">
                <GroupHeading>What {data.displayName} may do in Ri</GroupHeading>
                <ul className="space-y-2">
                  {data.riActions.map(({ name }) => {
                    const copy = CAPABILITY_COPY[name] ?? { label: name, hint: '' };
                    const allowed = riActions.includes(name);
                    return (
                      <li key={name} className="space-y-1">
                        <label className="flex items-start gap-2 text-[12px] text-foreground/90">
                          <Checkbox className="mt-0.5" checked={allowed} onCheckedChange={(value) => setRiActions((current) => (value === true ? [...new Set([...current, name])] : current.filter((item) => item !== name)))} />
                          <span>
                            <span className="font-medium text-foreground">{copy.label}</span>
                            {copy.hint && <span className="block text-muted-foreground">{copy.hint}</span>}
                          </span>
                        </label>
                        {name === 'ai_text' && data.background.supported && (
                          <label className="ml-6 flex items-center gap-2 text-[12px] text-foreground/90">
                            <Checkbox checked={background.includes(name)} onCheckedChange={(value) => setBackground((current) => (value === true ? [...new Set([...current, name])] : current.filter((item) => item !== name)))} />
                            Also during automatic updates
                          </label>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {data.background.supported && (
              <p className="text-[11px] text-muted-foreground">
                {automaticCount || background.length
                  ? `Automatic updates run every five minutes while ${data.displayName} is on.`
                  : 'Automatic updates are off. You can still continue an import from the app.'}
                {data.background.lastRunAt ? ` Last run ${new Date(data.background.lastRunAt).toLocaleString()}${data.background.lastOutcome ? ` (${data.background.lastOutcome.replace(/_/g, ' ')})` : ''}.` : ''}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!data || busy} onClick={() => void save()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

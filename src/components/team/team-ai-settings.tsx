'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiErrorText } from '@/lib/api/client';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { useTeam } from './team-context';
import { useTeamAiStatus } from './team-chat';

const button = (tone: 'default' | 'primary' | 'danger' = 'default') => cn(
  'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50',
  tone === 'primary' ? 'border-primary bg-primary text-primary-foreground hover:opacity-90' : 'border-border hover:bg-muted/50',
  tone === 'danger' && 'text-red-600 dark:text-red-400',
);

const input = 'w-full rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-sm outline-none focus-visible:border-primary/60';

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;
}

/**
 * Settings, Team AI (docs/homes-spec.md §9.9, P8.4). Everyone sees whether
 * it's on, whose account it uses and why it might not answer. The owner turns
 * it on with a key provisioned for the team, which nobody sees again.
 */
export function TeamAiSection() {
  const { team, member } = useTeam();
  const owner = member.role === 'owner';
  const status = useTeamAiStatus();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const data = status.data;
  const [label, setLabel] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: trpc.team.ai.status.queryKey() });
    void qc.invalidateQueries({ queryKey: trpc.team.ai.chats.list.queryKey() });
  };
  const save = useMutation({
    mutationFn: () => trpcClient.team.ai.configure.mutate({
      credentialLabel: (label ?? data?.credentialLabel ?? '').trim(),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      ...(model !== null ? { model: model.trim() || null } : {}),
    }),
    onSuccess: () => {
      setApiKey('');
      setLabel(null);
      setModel(null);
      toast.success('Saved');
      refresh();
    },
    onError: (err) => toast.error(apiErrorText(err)),
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => trpcClient.team.ai.setEnabled.mutate({ enabled }),
    onSuccess: refresh,
    onError: (err) => toast.error(apiErrorText(err)),
  });
  const forget = useMutation({
    mutationFn: () => trpcClient.team.ai.forgetKey.mutate(),
    onSuccess: refresh,
    onError: (err) => toast.error(apiErrorText(err)),
  });

  const state = data?.state ?? 'off';
  const summary = !data ? 'Checking…'
    : state === 'off' ? 'Off.'
      : state === 'ready' ? `On. ${data.runtime}${data.runtimeVersion ? ` ${data.runtimeVersion.replace(/\s*\(Claude Code\)$/, '')}` : ''} with the ${data.provider}${data.model ? `, ${data.model}` : ''}.`
        : data.reason ?? 'Not ready.';
  const hasKey = Boolean(data?.credentialSetAt);
  const labelValue = label ?? data?.credentialLabel ?? '';

  return (
    <section className="min-w-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Team AI</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        One AI the whole team talks to in Chat. It runs on {team.name}&apos;s host with Claude Code and works only with the team&apos;s tasks, notes and
        decisions: no files, shell or web, and nothing from anyone&apos;s own Ri.
      </p>
      <div className="mt-2 space-y-3">
        <p role="status" className="flex items-center gap-2 text-sm">
          <span aria-hidden className={cn('size-2 flex-shrink-0 rounded-full', state === 'ready' ? 'bg-emerald-500' : state === 'off' ? 'bg-muted-foreground/40' : 'bg-amber-500')} />
          <span className="min-w-0">{summary}</span>
        </p>
        {data?.credentialLabel && (
          <p className="text-xs">
            Uses <span className="font-medium">{data.credentialLabel}</span>. Everyone&apos;s use of Team AI counts against this account.
          </p>
        )}

        {owner && (
          <form
            className="space-y-2 rounded-md border border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <label className="block space-y-1">
              <span className="text-xs font-medium">Account</span>
              <input className={input} value={labelValue} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder={`${team.name}'s Anthropic account`} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium">Anthropic API key</span>
              <input
                className={input}
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasKey ? `Saved ${when(data?.credentialSetAt ?? null)}. Paste a new key to replace it.` : 'sk-ant-…'}
              />
              <span className="block text-[11px] text-muted-foreground">
                Make one for the team. Team AI never uses anyone&apos;s own Claude sign-in, and if this key stops working it stops rather than use another.
                It stays on the team&apos;s host, and nobody can see it again once it&apos;s saved.
              </span>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium">Model (optional)</span>
              <input className={input} value={model ?? data?.model ?? ''} onChange={(e) => setModel(e.target.value)} maxLength={100} placeholder="Claude Code's default" />
            </label>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button type="submit" className={button()} disabled={save.isPending || !labelValue.trim() || (!hasKey && !apiKey.trim())}>
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
              {data?.enabled ? (
                <button
                  type="button"
                  className={button()}
                  disabled={toggle.isPending}
                  onClick={async () => {
                    const ok = await confirm({
                      title: 'Turn off Team AI?',
                      description: 'Waiting messages are cancelled and an answer in progress stops. Chats stay readable, and members\' own AI clients keep working.',
                      confirmLabel: 'Turn off',
                    });
                    if (ok) toggle.mutate(false);
                  }}
                >
                  Turn off
                </button>
              ) : (
                <button type="button" className={button('primary')} disabled={toggle.isPending} onClick={() => toggle.mutate(true)}>
                  Turn on
                </button>
              )}
              {hasKey && (
                <button
                  type="button"
                  className={button('danger')}
                  disabled={forget.isPending}
                  onClick={async () => {
                    const ok = await confirm({ title: 'Remove the key?', description: 'Team AI stops answering until a new key is saved.', confirmLabel: 'Remove', tone: 'destructive' });
                    if (ok) forget.mutate();
                  }}
                >
                  Remove key
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

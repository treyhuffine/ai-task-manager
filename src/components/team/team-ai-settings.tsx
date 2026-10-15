'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { TeamAiAuthMode } from '@/db/types';
import { apiErrorText } from '@/lib/api/client';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useTeam } from './team-context';
import { useTeamAiStatus } from './team-chat';

const button = 'inline-flex items-center rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted/50 disabled:opacity-50';
const input = 'w-full rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-sm';

/** Subscription is the default. API billing is an explicit owner choice. */
export function TeamAiSection() {
  const { team, member } = useTeam();
  const status = useTeamAiStatus();
  const data = status.data;
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [model, setModel] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<TeamAiAuthMode | null>(null);
  const [apiKey, setApiKey] = useState('');
  const selectedAuth = authMode ?? data?.authMode ?? 'subscription';
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: trpc.team.ai.status.queryKey() });
    void qc.invalidateQueries({ queryKey: trpc.team.ai.chats.list.queryKey() });
  };
  const onError = (error: unknown) => toast.error(apiErrorText(error));
  const save = useMutation({
    mutationFn: () => trpcClient.team.ai.configure.mutate({ model: (model ?? data?.model ?? '').trim() || null }),
    meta: { carriesInput: true },
    onSuccess: () => { setModel(null); toast.success('Saved'); refresh(); }, onError,
  });
  const saveAuth = useMutation({
    mutationFn: () => trpcClient.team.ai.configure.mutate({ authMode: selectedAuth, ...(selectedAuth === 'api_key' && apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }),
    meta: { carriesInput: true },
    onSuccess: () => { setApiKey(''); setAuthMode(null); toast.success('Authentication saved'); refresh(); }, onError,
  });
  const toggle = useMutation({ mutationFn: (enabled: boolean) => trpcClient.team.ai.setEnabled.mutate({ enabled }), onSuccess: refresh, onError });
  const recheck = useMutation({ mutationFn: () => trpcClient.team.ai.refreshAuth.mutate(), onSuccess: refresh, onError });
  const forget = useMutation({ mutationFn: () => trpcClient.team.ai.forgetKey.mutate(), onSuccess: refresh, onError });
  const authPending = saveAuth.isPending || forget.isPending;
  const authChanged = selectedAuth !== (data?.authMode ?? 'subscription') || Boolean(apiKey.trim());
  const summary = !data ? 'Checking…' : data.state === 'off' ? 'Off.'
    : data.state === 'ready'
      ? data.authMode === 'api_key' ? 'On. Uses the saved Anthropic API key.' : 'On. Uses the Claude Code subscription signed in on this team’s host.'
      : data.reason;

  return (
    <section className="min-w-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Team AI</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Talk together in Chat about {team.name}&apos;s tasks, notes and decisions. Team AI runs with Claude Code on the computer hosting this team.
        {' '}{data?.authMode === 'api_key'
          ? 'Everyone’s use is billed separately to the Anthropic account for the saved API key.'
          : 'Everyone’s use counts toward the host’s Claude subscription limits.'}
      </p>
      <p className="mt-2 text-sm" role="status">{summary}</p>
      <p className="mt-1 text-xs text-muted-foreground">It can use shared team tools. Personal Ri content, files, shell commands and web browsing are unavailable.</p>
      {member.role === 'owner' && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={button} disabled={!data || toggle.isPending || authPending} onClick={async () => {
              if (data?.enabled && !await confirm({ title: 'Turn off Team AI?', description: 'Waiting messages are cancelled and an answer in progress stops. Chats stay readable.', confirmLabel: 'Turn off' })) return;
              toggle.mutate(!data?.enabled);
            }}>{data?.enabled ? 'Turn off' : 'Turn on'}</button>
            {data?.enabled && data.authMode === 'subscription' && <button type="button" className={button} disabled={recheck.isPending} onClick={() => recheck.mutate()}>{recheck.isPending ? 'Checking…' : 'Check sign-in'}</button>}
          </div>
          {data?.state === 'needs_sign_in' && <p className="text-xs text-muted-foreground">On the computer hosting {team.name}, run <code>claude auth login</code> and choose your Claude subscription.</p>}
          <form className="space-y-2 rounded-md border border-border p-3" onSubmit={event => { event.preventDefault(); saveAuth.mutate(); }}>
            <label className="block space-y-1">
              <span className="text-xs font-medium">Authentication</span>
              <select className={input} value={selectedAuth} disabled={!data || authPending} onChange={event => { setAuthMode(event.target.value as TeamAiAuthMode); setApiKey(''); }}>
                <option value="subscription">Subscription (default)</option>
                <option value="api_key">Anthropic API key</option>
              </select>
            </label>
            {selectedAuth === 'api_key' ? (
              <label className="block space-y-1">
                <span className="text-xs font-medium">Anthropic API key</span>
                <input className={input} type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={500} value={apiKey} onChange={event => setApiKey(event.target.value)} disabled={authPending} placeholder={data?.hasApiKey ? 'Key saved. Paste a new key to replace it.' : 'Paste your API key'} />
                <span className="block text-xs text-muted-foreground">Uses separate Anthropic API billing. The key is encrypted on the team host and is never shown again.</span>
              </label>
            ) : <p className="text-xs text-muted-foreground">Uses the host’s existing Claude Code sign-in.{data?.hasApiKey ? ' The saved API key is not used.' : ''}</p>}
            <p className="text-xs text-muted-foreground">Ri only uses the method you choose. Changing it or replacing the key stops current answers and waiting messages. Chat history stays readable.</p>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={button} disabled={!data || authPending || !authChanged || (selectedAuth === 'api_key' && !apiKey.trim() && !data.hasApiKey)}>{saveAuth.isPending ? 'Saving…' : 'Save authentication'}</button>
              {data?.hasApiKey && <button type="button" className={button} disabled={authPending} onClick={async () => {
                if (await confirm({ title: 'Remove the API key?', description: data.authMode === 'api_key' ? 'Team AI stops answering until you save a new key or choose Subscription.' : 'The saved key is removed. Subscription sign-in keeps working.', confirmLabel: 'Remove key', tone: 'destructive' })) forget.mutate();
              }}>Remove key</button>}
            </div>
          </form>
          <details className="rounded-md border border-border p-3">
            <summary className="cursor-pointer text-xs font-medium">Model</summary>
            <form className="mt-2 space-y-2" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
              <label className="block space-y-1">
                <span className="text-xs">Model (optional)</span>
                <input className={input} value={model ?? data?.model ?? ''} onChange={event => setModel(event.target.value)} maxLength={100} placeholder="Claude Code's default" />
              </label>
              <button type="submit" className={button} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</button>
            </form>
          </details>
        </div>
      )}
    </section>
  );
}

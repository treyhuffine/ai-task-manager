'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiErrorText } from '@/lib/api/client';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useTeam } from './team-context';
import { useTeamAiStatus } from './team-chat';

const button = 'inline-flex items-center rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted/50 disabled:opacity-50';

/** Enabling shares the host's existing subscription with this team's chat. */
export function TeamAiSection() {
  const { team, member } = useTeam();
  const status = useTeamAiStatus();
  const data = status.data;
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [model, setModel] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: trpc.team.ai.status.queryKey() });
    void qc.invalidateQueries({ queryKey: trpc.team.ai.chats.list.queryKey() });
  };
  const onError = (error: unknown) => toast.error(apiErrorText(error));
  const save = useMutation({
    mutationFn: () => trpcClient.team.ai.configure.mutate({ model: (model ?? data?.model ?? '').trim() || null }),
    onSuccess: () => { setModel(null); toast.success('Saved'); refresh(); }, onError,
  });
  const toggle = useMutation({ mutationFn: (enabled: boolean) => trpcClient.team.ai.setEnabled.mutate({ enabled }), onSuccess: refresh, onError });
  const recheck = useMutation({ mutationFn: () => trpcClient.team.ai.refreshAuth.mutate(), onSuccess: refresh, onError });
  const summary = !data ? 'Checking…' : data.state === 'off' ? 'Off.'
    : data.state === 'ready' ? 'On. Uses the Claude Code subscription signed in on this team’s host.' : data.reason;

  return (
    <section className="min-w-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Team AI</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Talk together in Chat about {team.name}&apos;s tasks, notes and decisions. Team AI uses the Claude Code subscription already signed in on the computer hosting this team.
        Everyone&apos;s use counts toward that subscription&apos;s limits.
      </p>
      <p className="mt-2 text-sm" role="status">{summary}</p>
      <p className="mt-1 text-xs text-muted-foreground">It can use shared team tools. Personal Ri content, files, shell commands and web browsing are unavailable.</p>
      {member.role === 'owner' && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={button} disabled={toggle.isPending} onClick={async () => {
              if (data?.enabled && !await confirm({ title: 'Turn off Team AI?', description: 'Waiting messages are cancelled and an answer in progress stops. Chats stay readable.', confirmLabel: 'Turn off' })) return;
              toggle.mutate(!data?.enabled);
            }}>{data?.enabled ? 'Turn off' : 'Turn on'}</button>
            {data?.enabled && <button type="button" className={button} disabled={recheck.isPending} onClick={() => recheck.mutate()}>{recheck.isPending ? 'Checking…' : 'Check sign-in'}</button>}
          </div>
          {data?.state === 'needs_sign_in' && <p className="text-xs text-muted-foreground">On the computer hosting {team.name}, run <code>claude auth login</code> and choose your Claude subscription.</p>}
          <details className="rounded-md border border-border p-3">
            <summary className="cursor-pointer text-xs font-medium">Model</summary>
            <form className="mt-2 space-y-2" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
              <label className="block space-y-1">
                <span className="text-xs">Model (optional)</span>
                <input className="w-full rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-sm" value={model ?? data?.model ?? ''} onChange={event => setModel(event.target.value)} maxLength={100} placeholder="Claude Code's default" />
              </label>
              <button type="submit" className={button} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</button>
            </form>
          </details>
        </div>
      )}
    </section>
  );
}

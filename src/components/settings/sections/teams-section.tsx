'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { apiErrorText } from '@/lib/api/client';
import { trpc, trpcClient } from '@/lib/trpc/client';
import type { RouterOutputs } from '@/lib/trpc/router';
import { cn } from '@/lib/utils';
import { invalidateTeamContent } from '@/lib/spaces/client-cache';

type Connection = RouterOutputs['spaces']['list'][number];
type LinkSummary = RouterOutputs['spaces']['inspectLink'];

/**
 * Teams in My Ri (docs/homes-spec.md §3.1, §9.3, P7.1). The teams this Ri is
 * connected to, joining one with an invitation, and connecting one already
 * joined in a browser with a sign-in link from it. Joining asks for no Area
 * or agent, and nothing personal goes to the team.
 */
export function TeamsSection() {
  const connections = useQuery(trpc.spaces.list.queryOptions());
  const list = connections.data ?? [];
  return (
    <div className="space-y-8">
      {list.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[12px] font-medium">Your teams</h3>
          <ul className="divide-y rounded-lg border">
            {list.map((connection) => <ConnectedTeam key={connection.id} connection={connection} />)}
          </ul>
        </section>
      )}
      <JoinTeam hasTeams={list.length > 0} />
      <CreateTeam />
    </div>
  );
}

function when(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const today = new Date().toDateString() === date.toDateString();
  return today ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : date.toLocaleDateString();
}

function connectionState(c: Connection): { text: string; tone: 'muted' | 'warn' } {
  if (c.status === 'revoked') return { text: `${c.name} no longer accepts this Ri's sign-in. Paste a new sign-in link from it below to reconnect.`, tone: 'warn' };
  if (c.status === 'disconnected') return { text: 'Disconnected. Your private planning for its work is kept.', tone: 'muted' };
  if (c.lastError) return { text: `${c.lastError}${c.lastSyncedAt ? ` Last updated ${when(c.lastSyncedAt)}.` : ''}`, tone: 'warn' };
  return { text: c.lastSyncedAt ? `Connected. Updated ${when(c.lastSyncedAt)}.` : 'Connected.', tone: 'muted' };
}

function ConnectedTeam({ connection }: { connection: Connection }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const state = connectionState(connection);
  const disconnect = useMutation({
    mutationFn: () => trpcClient.spaces.disconnect.mutate({ id: connection.id }),
    onSuccess: () => invalidateTeamContent(qc),
    onError: (err) => toast.error(apiErrorText(err)),
  });
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{connection.name}</p>
        <p className="text-xs text-muted-foreground">
          You are {connection.memberName}, {connection.role === 'owner' ? 'its owner' : 'a member'}.
        </p>
        <p className={cn('mt-1 text-xs', state.tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>{state.text}</p>
      </div>
      {connection.status === 'active' && (
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={`/space/${encodeURIComponent(connection.id)}`}>Open</a>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={disconnect.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: `Disconnect ${connection.name}?`,
                description: 'Its shared work leaves My Ri and this Ri signs out of the team. Your private planning is kept, and the team keeps your membership.',
                confirmLabel: 'Disconnect',
                tone: 'destructive',
              });
              if (ok) disconnect.mutate();
            }}
          >
            Disconnect
          </Button>
        </div>
      )}
    </li>
  );
}

function destination(summary: LinkSummary): { text: string; usable: boolean } {
  const team = summary.team?.name ?? 'this team';
  if (summary.state !== 'valid') {
    const reasons: Record<string, string> = {
      expired: 'This link has expired. Ask the team for a new one.',
      used: 'This link was already used. Ask the team for a new one.',
      revoked: 'This link was withdrawn. Ask the team for a new one.',
    };
    return { text: reasons[summary.state] ?? "This link isn't valid. Ask the team for a new one.", usable: false };
  }
  if (summary.link === 'setup') return { text: 'This link sets up a new team. Open it in a browser to finish, then connect the team here with a sign-in link from its Settings.', usable: false };
  if (summary.connected?.status === 'active' && summary.link === 'invite') {
    return { text: `This Ri is already connected to ${team} as ${summary.connected.memberName}.`, usable: false };
  }
  if (summary.link === 'invite') return { text: `Invitation to join ${team}`, usable: true };
  return { text: `Sign-in link for ${team}${summary.memberName ? `, as ${summary.memberName}` : ''}`, usable: true };
}

function JoinTeam({ hasTeams }: { hasTeams: boolean }) {
  const qc = useQueryClient();
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [summary, setSummary] = useState<{ link: string; value: LinkSummary } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const checking = useRef(0);

  // Where the pasted link leads, shown before anything is joined.
  useEffect(() => {
    const value = link.trim();
    if (!value) return;
    const attempt = ++checking.current;
    const timer = setTimeout(() => {
      trpcClient.spaces.inspectLink
        .mutate({ link: value })
        .then((result) => {
          if (attempt !== checking.current) return;
          setSummary({ link: value, value: result });
          setProblem(null);
        })
        .catch((err: unknown) => {
          if (attempt !== checking.current) return;
          setSummary(null);
          setProblem(apiErrorText(err));
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [link]);

  const current = summary && summary.link === link.trim() ? summary.value : null;
  const shown = current ? destination(current) : null;
  const joining = current?.link === 'invite';
  const connect = useMutation({
    mutationFn: () => trpcClient.spaces.connect.mutate({ link: link.trim(), ...(joining ? { name: name.trim() } : {}) }),
    onSuccess: (connection) => {
      toast.success(`${connection.name} is connected to My Ri.`);
      setLink('');
      setName('');
      setSummary(null);
      invalidateTeamContent(qc);
    },
    onError: (err) => setProblem(apiErrorText(err)),
  });

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-[12px] font-medium">{hasTeams ? 'Join or connect another team' : 'Join a team'}</h3>
        <p className="mt-1 text-xs text-muted-foreground">Paste an invitation, or a sign-in link from a team you already joined.</p>
      </div>
      <form
        className="space-y-3 rounded-lg border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (shown?.usable && (!joining || name.trim())) connect.mutate();
        }}
      >
        <label className="block space-y-1">
          <span className="text-xs font-medium">Team link</span>
          <Input
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
              setProblem(null);
              if (!e.target.value.trim()) setSummary(null);
            }}
            placeholder="https://…/join#invite=…"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        {shown && (
          <p role="status" className={cn('border-l-2 pl-3 text-sm', shown.usable ? 'border-primary font-medium' : 'border-amber-500 text-muted-foreground')}>
            {shown.text}
          </p>
        )}
        {joining && shown?.usable && (
          <label className="block space-y-1">
            <span className="text-xs font-medium">Your name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" />
            <span className="block text-xs text-muted-foreground">What the team sees on your work.</span>
          </label>
        )}
        {shown?.usable && <p className="text-xs text-muted-foreground">Your assigned tasks will appear in My Ri. Your personal work stays private.</p>}
        {problem && <p role="alert" className="text-xs text-destructive">{problem}</p>}
        <Button type="submit" size="sm" disabled={!shown?.usable || (joining && !name.trim()) || connect.isPending}>
          {connect.isPending ? 'Connecting…' : joining ? 'Join team' : 'Connect'}
        </Button>
      </form>
    </section>
  );
}

const noSubscription = () => () => {};

function CreateTeam() {
  // The desktop app can make a team on this computer. A browser can't.
  const desktop = useSyncExternalStore(noSubscription, () => !!window.riDesktop?.connection, () => false);
  return (
    <section className="space-y-2">
      <h3 className="text-[12px] font-medium">Create a team</h3>
      <p className="text-xs text-muted-foreground">
        A team is a separate place for shared tasks and notes, on a computer of its own. Nothing from My Ri is copied into it.
        {!desktop && (
          <>
            {' '}Create one from the Ri desktop app, or on a server with <code className="rounded bg-muted px-1 py-0.5 text-[11px]">ri team create</code>.
          </>
        )}
      </p>
      {desktop && (
        <Button variant="outline" size="sm" onClick={() => void window.riDesktop?.connection?.('create-team')}>
          Create a team
        </Button>
      )}
    </section>
  );
}

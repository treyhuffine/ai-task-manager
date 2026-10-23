'use client';

import { useMutation, useQueryClient, useQueries } from '@tanstack/react-query';
import { useRuntimeStatus, useSendMessage } from '@/hooks/use-execution';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { toast } from 'sonner';
import { apiErrorText } from '@/lib/api/client';
import { useCallback, useMemo } from 'react';
import { useOptionalHomeContext } from '@/components/home/home-context';
import { MemberAvatar } from '@/components/team/member-avatar';
import { useTeamMembers } from '@/components/team/use-team';
import type { SessionRuntimeStatus } from '@/lib/executor/runtime-status';
import type { ChatEventDTO } from '@/lib/api/dto/chat-event';
import { cn } from '@/lib/utils';

/** A persistent audience label, independent of a chat's model or execution device. */
export function ChatAudience({ name, className, createdByMemberId }: { name?: string; className?: string; createdByMemberId?: string | null }) {
  const home = useOptionalHomeContext();
  const members = useTeamMembers(home?.home.kind === 'team');
  const creator = createdByMemberId ? members.byId.get(createdByMemberId)?.name : null;
  const teamName = name ?? (home?.home.kind === 'team' ? home.home.name : null);
  if (!teamName) return null;
  return <div className={cn('shrink-0 border-b border-border/50 px-4 py-1.5 text-[11px] text-muted-foreground', className)}>Everyone in {teamName} can read this chat.{createdByMemberId !== undefined && (creator ? <> Created by {creator}.</> : <> Creator not recorded.</>)}</div>;
}

export function MemberMessageHeader({ name }: { name?: string | null }) {
  const label = name ?? 'Someone who left';
  return <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold"><MemberAvatar name={label} size="sm" />{label}</div>;
}

export function useMemberMessageHeader(events: readonly ChatEventDTO[] | undefined, sessionId?: string) {
  const home = useOptionalHomeContext();
  const enabled = home?.home.kind === 'team';
  const members = useTeamMembers(enabled);
  const runtime = useRuntimeStatus(enabled && sessionId ? sessionId : null);
  const messageIds = useMemo(() => (events ?? []).filter(event => event.source === 'user').map(event => event.id), [events]);
  const pages = useQueries({ queries: enabled && sessionId ? Array.from({ length: Math.ceil(messageIds.length / 200) }, (_, page) => ({
    ...trpc.team.ai.turnsForMessages.queryOptions({ chatId: sessionId, messageIds: messageIds.slice(page * 200, page * 200 + 200) }),
    staleTime: 60_000,
  })) : [] });
  const turns = useMemo(() => {
    const values = new Map(pages.flatMap(page => page.data ?? []).map(turn => [turn.messageEventId, turn]));
    for (const turn of runtime.data?.teamTurns ?? []) values.set(turn.messageEventId, turn);
    return values;
  }, [pages, runtime.data?.teamTurns]);
  const authors = useMemo(() => new Map((events ?? []).map(event => [event.id, event.authorMemberId])), [events]);
  return useCallback((event: Pick<ChatEventDTO, 'id' | 'source'>) => {
    if (!enabled || event.source !== 'user') return null;
    const memberId = authors.get(event.id);
    const message = events?.find(value => value.id === event.id);
    const turn = turns.get(event.id);
    return <><MemberMessageHeader name={memberId ? members.byId.get(memberId)?.name : null}/>{sessionId && turn && message && <TeamTurnControls sessionId={sessionId} turn={turn} message={message}/>}</>;
  }, [enabled, authors, members.byId, events, turns, sessionId]);
}

/** Shared saved artifacts use the same member directory as transcript messages. */
export function useSavedWorkAuthor() {
  const home = useOptionalHomeContext();
  const members = useTeamMembers(home?.home.kind === 'team');
  return (record: { actorMemberId?: string | null; actorSource: string; actorUserId: string }) => {
    if (record.actorMemberId) {
      const name = members.byId.get(record.actorMemberId)?.name ?? 'Someone who left';
      return record.actorSource === 'human' ? name : record.actorSource === 'ai' ? `the agent for ${name}` : `Ri for ${name}`;
    }
    return record.actorSource === 'human' ? record.actorUserId === 'local' ? 'you' : record.actorUserId : record.actorSource === 'ai' ? 'the agent' : 'Ri';
  };
}


/** Contextual receipts and controls around the ordinary transcript. */
export function TeamTurnControls({ sessionId, turn, message }: { sessionId: string; turn: NonNullable<SessionRuntimeStatus['teamTurns']>[number]; message: ChatEventDTO }) {
  const cache = useQueryClient();
  const send = useSendMessage(sessionId);
  const cancel = useMutation({ mutationFn: () => trpcClient.sessions.interruptPost.mutate({ params: { id: sessionId }, body: { turnId: turn.id } }),
    onSuccess: () => { void cache.invalidateQueries(trpc.sessions.runtimeStatusGet.pathFilter()); },
    onError: error => toast.error(apiErrorText(error)) });
  if (turn.status === 'done' || turn.status === 'running') return null;
  return <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground" role="status">
    <span>{turn.status === 'queued' ? 'Queued' : turn.error ?? turn.status}</span>
    {turn.status === 'queued' ? <button className="underline" disabled={cancel.isPending} onClick={() => cancel.mutate()}>Cancel queued message</button>
      : <button className="underline" disabled={send.isPending} onClick={() => send.mutate({ content: message.content ?? '', attachments: message.attachments ?? [] })}>Send again</button>}
  </div>;
}

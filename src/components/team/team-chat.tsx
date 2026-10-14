'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Link2, Loader2, MessageCircle, Plus, Square, Wrench } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiErrorText } from '@/lib/api/client';
import { trpc, trpcClient } from '@/lib/trpc/client';
import type { RouterOutputs } from '@/lib/trpc/router';
import { MessageResponse } from '@/components/ai-elements/message';
import { ListToolbar, toolbarButtonClass } from '@/components/shared/list-toolbar';
import { Tip } from '@/components/ui/tip';
import { cn } from '@/lib/utils';
import { useTeam, useTeamNav } from './team-context';
import { MemberAvatar } from './member-avatar';

type Page = RouterOutputs['team']['ai']['events'];
type ChatEvent = Page['events'][number];
type Turn = Page['turns'][number];

interface ComposerDraft {
  text: string;
  pending: { id: string; text: string } | null;
  failed: string | null;
}
const EMPTY_DRAFT: ComposerDraft = { text: '', pending: null, failed: null };
type UpdateDraft = (update: (current: ComposerDraft) => ComposerDraft) => void;

const BUSY_POLL_MS = 1_000;
const IDLE_POLL_MS = 4_000;
const HIDDEN_POLL_MS = 15_000;

/** Team AI's status, for every member. */
export function useTeamAiStatus() {
  return useQuery({ ...trpc.team.ai.status.queryOptions(), staleTime: 15_000 });
}

/**
 * A chat's events as they're written: the latest page when it opens, then
 * whatever came after the last cursor, so reconnecting never repeats or
 * skips anything (docs/homes-spec.md §9.9). Faster while a turn is waiting
 * or running.
 */
function useChatFeed(chatId: string | null) {
  const [feed, setFeed] = useState<{ chatId: string; chat: Page['chat']; events: ChatEvent[]; turns: Turn[]; hasOlder: boolean } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const poke = useRef<() => void>(() => {});
  const older = useRef<() => Promise<void>>(async () => {});
  const [loadingOlder, setLoadingOlder] = useState(false);
  useEffect(() => {
    if (!chatId) return;
    let stopped = false;
    let cursor: number | undefined;
    let oldestCursor: number | null = null;
    let hasOlder = false;
    let loading = false;
    let inFlight = false;
    let again = false;
    setLoadingOlder(false);
    let events: ChatEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped) return;
      if (inFlight) { again = true; return; }
      inFlight = true;
      clearTimeout(timer);
      let busy = false;
      try {
        const page = await trpcClient.team.ai.events.query({ chatId, ...(cursor === undefined ? {} : { after: cursor }) });
        if (stopped) return;
        const seen = new Set(events.map((e) => e.id));
        events = [...events, ...page.events.filter((e) => !seen.has(e.id))];
        if (cursor === undefined) {
          oldestCursor = page.oldestCursor;
          hasOlder = page.hasOlder;
        }
        cursor = page.cursor;
        busy = page.turns.some((t) => t.status === 'queued' || t.status === 'running');
        setFeed(current => ({ chatId, chat: page.chat, events, hasOlder, turns: [...new Map([...(current?.chatId === chatId ? current.turns : []), ...page.turns].map(turn => [turn.id, turn])).values()] }));
        setProblem(null);
      } catch (err) {
        if (stopped) return;
        setProblem(apiErrorText(err));
      } finally {
        inFlight = false;
      }
      if (stopped) return;
      timer = setTimeout(() => void tick(), again ? 0 : document.hidden ? HIDDEN_POLL_MS : busy ? BUSY_POLL_MS : IDLE_POLL_MS);
      again = false;
    };
    older.current = async () => {
      if (loading || !hasOlder || oldestCursor === null) return;
      loading = true;
      setLoadingOlder(true);
      try {
        const page = await trpcClient.team.ai.events.query({ chatId, before: oldestCursor });
        if (stopped) return;
        const seen = new Set(events.map(event => event.id));
        events = [...page.events.filter(event => !seen.has(event.id)), ...events];
        oldestCursor = page.oldestCursor;
        hasOlder = page.hasOlder;
        setFeed(current => current?.chatId === chatId ? {
          ...current, events, hasOlder,
          turns: [...new Map([...page.turns, ...current.turns].map(turn => [turn.id, turn])).values()],
        } : current);
        setProblem(null);
      } catch (err) {
        if (!stopped) setProblem(apiErrorText(err));
      } finally {
        loading = false;
        if (!stopped) setLoadingOlder(false);
      }
    };
    poke.current = () => void tick();
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [chatId]);
  return { feed: feed && feed.chatId === chatId ? feed : null, problem, loadingOlder, loadOlder: () => void older.current(), refresh: () => poke.current() };
}

const TOOL_LABELS: Record<string, string> = {
  search: 'Searched the team',
  list_tasks: 'Looked through tasks',
  get_task: 'Read a task',
  list_notes: 'Looked through notes',
  get_note: 'Read a note',
  list_areas: 'Looked at Areas',
  get_area: 'Read an Area',
  list_members: 'Looked up who is in the team',
  list_links: 'Followed links',
  list_history: 'Read the history',
  list_published_results: 'Read published results',
  search_sessions: 'Searched the team\'s chats',
  get_session_messages: 'Read a chat',
  create_task: 'Added a task',
  update_task: 'Changed a task',
  transition_task: 'Moved a task',
  complete_task: 'Completed a task',
  create_note: 'Saved a note',
  update_note: 'Changed a note',
};

/** One line for what Team AI did with a tool, in the team's words. */
export function toolLine(toolName: string | null, input: string | null): { label: string; detail: string | null; outside: boolean } {
  const name = toolName ?? 'a tool';
  const short = name.replace(/^mcp__ri_team__/, '');
  const outside = !name.startsWith('mcp__ri_team__');
  let detail: string | null = null;
  try {
    const parsed = input ? (JSON.parse(input) as Record<string, unknown>) : null;
    const value = parsed?.query ?? parsed?.title ?? parsed?.command ?? null;
    if (typeof value === 'string') detail = value.length > 80 ? `${value.slice(0, 80)}…` : value;
  } catch {
    // A long input shown cut short isn't JSON: no detail.
  }
  return { label: outside ? `Tried ${name}, which Team AI can't use` : TOOL_LABELS[short] ?? short, detail, outside };
}

function turnNote(turn: Turn | undefined, own: boolean): { text: string; tone: 'muted' | 'busy' | 'warn' } | null {
  if (!turn) return null;
  if (turn.status === 'queued') return { text: 'Waiting for the message before it.', tone: 'muted' };
  if (turn.status === 'running') return { text: 'Team AI is answering…', tone: 'busy' };
  if (turn.status === 'cancelled') return { text: turn.error ?? 'Stopped.', tone: 'muted' };
  if (turn.status === 'interrupted') return { text: turn.error ?? 'Interrupted.', tone: 'warn' };
  if (turn.status === 'failed') return { text: `Team AI couldn't answer${own ? ' you' : ''}: ${turn.error ?? 'something went wrong.'}`, tone: 'warn' };
  return null;
}

export function TeamChat() {
  const { team, member } = useTeam();
  const nav = useTeamNav();
  const status = useTeamAiStatus();
  const chats = useQuery({ ...trpc.team.ai.chats.list.queryOptions(), refetchInterval: 15_000 });
  const chatId = nav.chatId ?? chats.data?.find((c) => c.main)?.id ?? chats.data?.[0]?.id ?? null;
  const { feed, problem, refresh, loadingOlder, loadOlder } = useChatFeed(chatId);
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  // Switching chats retains each draft and its retry id with that chat.
  const [drafts, setDrafts] = useState<Record<string, ComposerDraft>>({});
  const create = useMutation({
    mutationFn: (label: string) => trpcClient.team.ai.chats.create.mutate({ label }),
    onSuccess: (made) => {
      setCreating(false);
      setNewLabel('');
      void chats.refetch();
      nav.openChat(made.id);
    },
    onError: (err) => toast.error(apiErrorText(err)),
  });

  const ready = status.data?.state === 'ready';
  const turnsByMessage = useMemo(() => new Map((feed?.turns ?? []).map((t) => [t.messageEventId, t])), [feed?.turns]);

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-56 flex-shrink-0 flex-col border-r border-border/60 @2xl/lt:flex" aria-label="Chats">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Chats</span>
          {status.data?.enabled && (
            <Tip label="New chat">
              <button type="button" aria-label="New chat" onClick={() => setCreating(true)} className="rounded p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground">
                <Plus size={14} />
              </button>
            </Tip>
          )}
        </div>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          {(chats.data ?? []).map((chat) => (
            <li key={chat.id}>
              <button
                type="button"
                onClick={() => nav.openChat(chat.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px]',
                  chat.id === chatId ? 'bg-muted/60 text-foreground' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                )}
              >
                <MessageCircle size={13} className="flex-shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{chat.label ?? 'Chat'}</span>
                {chat.working && <Loader2 size={11} className="flex-shrink-0 animate-spin" aria-label="Answering" />}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col" aria-label={feed?.chat.label ?? 'Chat'}>
        <ListToolbar>
          <select
            aria-label="Chat"
            className="max-w-[12rem] truncate rounded-md border border-border bg-transparent px-2 py-1 text-[12px] font-semibold @2xl/lt:hidden"
            value={chatId ?? ''}
            onChange={(e) => (e.target.value === '__new' ? setCreating(true) : nav.openChat(e.target.value))}
          >
            {(chats.data ?? []).map((chat) => <option key={chat.id} value={chat.id}>{chat.label ?? 'Chat'}</option>)}
            {status.data?.enabled && <option value="__new">New chat…</option>}
          </select>
          <span className="hidden truncate px-1 text-[12px] font-semibold @2xl/lt:inline">{feed?.chat.label ?? 'Chat'}</span>
          <span className="hidden truncate text-[11px] text-muted-foreground @md/lt:inline">Everyone in {team.name} can read this chat.</span>
          <div className="flex-1" />
          {chatId && (
            <Tip label="Copy a link to this chat">
              <button
                type="button"
                aria-label="Copy link"
                className={toolbarButtonClass()}
                onClick={async () => {
                  const url = new URL(window.location.href);
                  url.search = `?view=chat&chat=${encodeURIComponent(chatId)}`;
                  await navigator.clipboard.writeText(url.toString()).catch(() => {});
                  toast.success('Link copied');
                }}
              >
                <Link2 className="size-3.5" />
              </button>
            </Tip>
          )}
        </ListToolbar>

        {creating && (
          <form
            className="flex items-center gap-2 border-b border-border/60 px-4 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newLabel.trim()) create.mutate(newLabel.trim());
            }}
          >
            <input
              autoFocus
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              maxLength={120}
              placeholder="What's this chat about?"
              aria-label="New chat's name"
              className="min-w-0 flex-1 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-sm outline-none focus-visible:border-primary/60"
            />
            <button type="submit" className={toolbarButtonClass()} disabled={!newLabel.trim() || create.isPending}>Start</button>
            <button type="button" className={toolbarButtonClass()} onClick={() => setCreating(false)}>Cancel</button>
          </form>
        )}

        <Transcript
          events={feed?.events ?? null}
          turnsByMessage={turnsByMessage}
          memberId={member.id}
          isOwner={member.role === 'owner'}
          teamName={team.name}
          onStopped={refresh}
          hasChat={Boolean(chatId)}
          hasOlder={feed?.hasOlder ?? false}
          loadingOlder={loadingOlder}
          loadOlder={loadOlder}
        />
        {problem && <p role="status" className="px-4 pb-1 text-[11px] text-amber-700 dark:text-amber-300">Reconnecting: {problem}</p>}

        {chatId && !feed?.chat.archived && (
          <Composer key={chatId} chatId={chatId} draft={drafts[chatId] ?? EMPTY_DRAFT}
            updateDraft={update => setDrafts(current => ({ ...current, [chatId]: update(current[chatId] ?? EMPTY_DRAFT) }))}
            ready={ready} reason={status.data?.reason ?? (status.data?.enabled === false ? "Team AI is off. The team's owner can turn it on in Settings." : null)} onSent={refresh} />
        )}
      </section>
    </div>
  );
}

function Transcript({ events, turnsByMessage, memberId, isOwner, teamName, onStopped, hasChat, hasOlder, loadingOlder, loadOlder }: {
  events: ChatEvent[] | null;
  turnsByMessage: Map<string, Turn>;
  memberId: string;
  isOwner: boolean;
  teamName: string;
  onStopped: () => void;
  hasChat: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  const lastId = events?.at(-1)?.id;
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [lastId]);
  const stop = useMutation({
    mutationFn: (turnId: string) => trpcClient.team.ai.stop.mutate({ turnId }),
    onSuccess: onStopped,
    onError: (err) => toast.error(apiErrorText(err)),
  });

  if (!hasChat) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
        <MessageCircle size={20} className="text-muted-foreground/60" />
        <p>{teamName} has no chats with Team AI yet. The team&apos;s owner can turn Team AI on in Settings.</p>
      </div>
    );
  }
  if (!events) {
    return <div className="flex flex-1 items-center justify-center text-muted-foreground"><Loader2 size={16} className="animate-spin" /></div>;
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      {hasOlder && <div className="mx-auto mb-4 max-w-3xl text-center">
        <button type="button" className={toolbarButtonClass()} onClick={loadOlder} disabled={loadingOlder}>
          {loadingOlder ? 'Loading…' : 'Load earlier messages'}
        </button>
      </div>}
      {events.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Ask Team AI about {teamName}&apos;s work: what was decided, what&apos;s in progress, what to do next. Everyone in the team can read this chat.
        </p>
      )}
      <ol className="mx-auto max-w-3xl space-y-3">
        {events.map((event) => {
          if (event.source === 'user') {
            const turn = turnsByMessage.get(event.id);
            const own = event.author?.id === memberId;
            const note = turnNote(turn, own);
            return (
              <li key={event.id} className="space-y-1">
                <div className="flex items-start gap-2">
                  <MemberAvatar name={event.author?.name ?? '?'} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold">{event.author?.name ?? 'Someone who left'}</p>
                    <p className="whitespace-pre-wrap break-words text-[13px]">{event.content}</p>
                  </div>
                </div>
                {note && (
                  <p className={cn('ml-8 flex items-center gap-1.5 text-[11px]', note.tone === 'warn' ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground')}>
                    {note.tone === 'busy' && <Loader2 size={11} className="animate-spin" aria-hidden />}
                    {note.tone === 'warn' && <AlertCircle size={11} aria-hidden />}
                    {note.text}
                    {turn && (turn.status === 'queued' || turn.status === 'running') && (own || isOwner) && (
                      <button type="button" className="ml-1 inline-flex items-center gap-1 underline" onClick={() => stop.mutate(turn.id)} disabled={stop.isPending}>
                        <Square size={9} aria-hidden /> Stop
                      </button>
                    )}
                  </p>
                )}
              </li>
            );
          }
          if (event.source === 'agent' && event.content) {
            return (
              <li key={event.id} className="flex items-start gap-2">
                <span aria-hidden className="mt-0.5 inline-flex size-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">AI</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold">Team AI</p>
                  <MessageResponse className="text-[13px] [&_li]:text-[13px] [&_p]:text-[13px]">{event.content}</MessageResponse>
                </div>
              </li>
            );
          }
          if (event.source === 'tool_call') {
            const line = toolLine(event.toolName, event.toolInput);
            return (
              <li key={event.id} className={cn('ml-8 flex items-center gap-1.5 text-[11px]', line.outside ? 'text-amber-700/80 dark:text-amber-300/80' : 'text-muted-foreground')}>
                <Wrench size={11} aria-hidden />
                <span>{line.label}</span>
                {line.detail && <span className="truncate text-muted-foreground/70">“{line.detail}”</span>}
              </li>
            );
          }
          if (event.source === 'error' && event.content) {
            return (
              <li key={event.id} className="ml-8 flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                <AlertCircle size={11} aria-hidden /> {event.content}
              </li>
            );
          }
          return null;
        })}
      </ol>
      <div ref={end} />
    </div>
  );
}

function Composer({ chatId, draft, updateDraft, ready, reason, onSent }: {
  chatId: string; draft: ComposerDraft; updateDraft: UpdateDraft; ready: boolean; reason: string | null; onSent: () => void;
}) {
  // One id per message, kept across retries, so a lost response is never a second turn.
  const { text, pending, failed } = draft;
  const send = useMutation({
    mutationFn: (input: { id: string; text: string }) => trpcClient.team.ai.send.mutate({ chatId, clientSendId: input.id, text: input.text }),
    meta: { carriesInput: true },
    onSuccess: (_result, sent) => {
      // The acknowledged message may no longer be the text being edited.
      updateDraft(current => current.pending?.id !== sent.id ? current : {
        text: current.text.trim() === sent.text ? '' : current.text, pending: null, failed: null,
      });
      onSent();
    },
    onError: (err, sent) => {
      updateDraft(current => current.pending?.id !== sent.id ? current : { ...current, failed: apiErrorText(err) });
      onSent();
    },
  });
  const submit = useCallback(() => {
    const value = text.trim();
    if (!value || send.isPending) return;
    const next = pending && pending.text === value ? pending : { id: crypto.randomUUID(), text: value };
    updateDraft(current => ({ ...current, pending: next, failed: null }));
    send.mutate(next);
  }, [text, pending, send, updateDraft]);

  return (
    <form
      className="border-t border-border/60 px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {!ready && reason && <p role="status" className="mb-2 text-[11px] text-muted-foreground">{reason}</p>}
      {failed && <p role="alert" className="mb-2 text-[11px] text-amber-700 dark:text-amber-300">{failed}</p>}
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => {
            const value = e.target.value;
            updateDraft(current => ({ ...current, text: value }));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          maxLength={20_000}
          disabled={!ready}
          placeholder={ready ? 'Ask Team AI, or tell it what to record…' : 'Team AI can’t answer right now'}
          aria-label="Message to Team AI"
          className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-border bg-muted/30 px-3 py-2 text-sm outline-none focus-visible:border-primary/60 disabled:opacity-60"
        />
        <button type="submit" disabled={!ready || !text.trim() || send.isPending} className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50">
          {send.isPending ? 'Sending…' : failed && pending ? 'Retry' : 'Send'}
        </button>
      </div>
    </form>
  );
}

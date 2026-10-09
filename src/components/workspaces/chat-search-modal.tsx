'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Command } from 'cmdk';
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui';
import { Bot, ChevronDown, GitBranch, Loader2, Search, TextSearch, X } from 'lucide-react';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { useDashboard } from '@/contexts/dashboard-context';
import type { Attachment } from '@/db/types';
import { useSessionSearch } from '@/hooks/use-session-search';
import { useHistorySessions, useWorkspaces } from '@/hooks/use-workspaces';
import { coverAttachmentUrl } from '@/lib/attachments/view';
import { executionView } from '@/lib/client/active-view';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import { sortSessionsHotnessDesc } from '@/lib/utils/session-sort';
import type { RailSession, SessionSearchFilters } from '@/lib/api/sessions';
import { containsAllTerms, highlightTerms, searchTerms } from '@/lib/search/highlight';
import { cn } from '@/lib/utils';
import {
  HighlightedText,
  SearchSnippet,
  WorkspaceAvatar,
  sessionDisplayLabel,
  sessionRankedAt,
} from './history-row';
import { closeChatSearch, useChatSearchOpen } from './chat-search-store';
import { LauncherPopoverContent } from './launcher/launcher-popover';

type StatusFacet = 'all' | 'active' | 'archived';
type SourceFacet = 'all' | 'native' | 'imported';

/** What the agent filter needs to name and picture an agent. */
interface AgentOption {
  id: string;
  name: string;
  emoji: string | null;
  attachments: Attachment[] | null;
}

/** How many recent chats an empty query shows. */
const RECENT_LIMIT = 8;

const GROUP_CLASS =
  'px-2 pb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[9px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground/60';

/**
 * Search every chat's title and transcript, in a modal. It used to be a box in
 * the rail that swapped the rail's body for results, which left a 256px column
 * to read snippets in and hid the agents you'd come back to. Here results get
 * the width, and the rail stays as it was.
 *
 * Chats whose title has every word come first, with the words marked in it,
 * then message matches ranked by relevance (BM25). Each row has its date,
 * agent, branch and, for a message match, a highlighted snippet, narrowed by
 * status (active / archived) and source (native / imported). With no query it
 * lists recent chats, so it doubles as a quick switcher. The agent filter
 * beside the query narrows both, the recent list and the results, to one
 * agent's chats. Arrows and Enter open a chat. Opened from the rail's Search
 * chats row or "Search chats" in ⌘K.
 */
export function ChatSearchModal() {
  const open = useChatSearchOpen();
  return (
    <Command.Dialog
      open={open}
      onOpenChange={(next) => !next && closeChatSearch()}
      label="Search chats"
      shouldFilter={false}
      loop
      className="fixed inset-0 z-50"
    >
      <VisuallyHidden.Root>
        <DialogPrimitive.Title>Search chats</DialogPrimitive.Title>
        <DialogPrimitive.Description>
          Search the titles and transcripts of every chat, active or archived.
        </DialogPrimitive.Description>
      </VisuallyHidden.Root>
      {/* Mounted only while open, so every open starts from an empty query. */}
      {open && <ChatSearchPanel />}
    </Command.Dialog>
  );
}

function ChatSearchPanel() {
  const { setActiveView } = useDashboard();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFacet>('all');
  const [source, setSource] = useState<SourceFacet>('all');
  const [agentId, setAgentId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // The rail's agents, in its order. An agent archived while this is open
  // drops out of the filter rather than leaving a scope the chip can't name.
  const { data: agents } = useWorkspaces({ status: 'active' });
  const agent = agents?.find((w) => w.id === agentId) ?? null;

  // Defer so we fire one request per settle, not per keystroke.
  const deferredQuery = useDeferredValue(query);
  const filters: SessionSearchFilters = {
    status: status === 'all' ? undefined : status,
    source: source === 'all' ? undefined : source,
    workspaceId: agent?.id,
  };
  const searching = query.trim().length > 0;
  const { data: results, isLoading, isFetching } = useSessionSearch(deferredQuery, filters);
  // Scoped on the server, so a quiet agent's chats aren't lost below the
  // newest 200 across every agent.
  const { data: history, isPending: historyPending } = useHistorySessions(!searching, agent?.id ?? null);

  // The same order as the rail's History tab, newest work first.
  const recent = useMemo(
    () => sortSessionsHotnessDesc(history?.sessions ?? []).slice(0, RECENT_LIMIT),
    [history?.sessions],
  );

  // A new query or facet starts the list at its best match.
  useEffect(() => {
    listRef.current?.scrollTo(0, 0);
  }, [results]);

  const openChat = (sessionId: string) => {
    closeChatSearch();
    setActiveView(executionView(sessionId));
  };

  const hits = results ?? [];
  const trimmed = deferredQuery.trim();
  const terms = useMemo(() => searchTerms(trimmed), [trimmed]);
  const settling = searching && (deferredQuery !== query || isFetching);

  return (
    <>
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={closeChatSearch} />

      <div className="relative mx-auto mt-[15vh] w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <TextSearch size={16} className="flex-shrink-0 text-muted-foreground" />
          <Command.Input
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            placeholder={agent ? `Search chats in ${agent.name}…` : 'Search chats…'}
            className="min-w-0 flex-1 border-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {settling && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
          <AgentFilter agents={agents ?? []} value={agent} onChange={setAgentId} returnFocusTo={inputRef} />
          <button
            type="button"
            onClick={closeChatSearch}
            aria-label="Close search"
            className="p-1 text-muted-foreground hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>

        {/* The rail's controls, shown while there's a query to narrow. */}
        {searching && (
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2">
            <Segmented
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: 'All' },
                { value: 'active', label: 'Active' },
                { value: 'archived', label: 'Archived' },
              ]}
            />
            <Segmented
              label="Source"
              value={source}
              onChange={setSource}
              options={[
                { value: 'all', label: 'All' },
                { value: 'native', label: 'Native' },
                { value: 'imported', label: 'Imported' },
              ]}
            />
          </div>
        )}

        <Command.List ref={listRef} className="max-h-[60vh] overflow-y-auto py-1">
          {!searching ? (
            recent.length > 0 ? (
              <Command.Group heading="Recent" className={GROUP_CLASS}>
                {recent.map((s) => (
                  <ChatResultItem key={s.id} session={s} onOpen={openChat} />
                ))}
              </Command.Group>
            ) : agent && historyPending ? (
              <p className="flex items-center justify-center gap-2 p-8 text-[11px] text-muted-foreground">
                <Loader2 size={12} className="animate-spin" />
                Loading chats…
              </p>
            ) : agent ? (
              <p className="p-8 text-center text-[11px] text-muted-foreground">No chats in {agent.name} yet</p>
            ) : (
              <p className="p-8 text-center text-[11px] text-muted-foreground">
                Type to search every chat{'’'}s title and messages
              </p>
            )
          ) : hits.length > 0 ? (
            <Command.Group
              heading={`${hits.length} match${hits.length === 1 ? '' : 'es'}`}
              className={GROUP_CLASS}
            >
              {hits.map((r) => (
                <ChatResultItem
                  key={r.id}
                  session={r}
                  terms={terms}
                  matchedIn={r.matchedIn}
                  snippet={r.snippet}
                  onOpen={openChat}
                />
              ))}
            </Command.Group>
          ) : isLoading || settling ? (
            <p className="flex items-center justify-center gap-2 p-8 text-[11px] text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              Searching chats…
            </p>
          ) : (
            <p className="p-8 text-center text-[11px] text-muted-foreground">
              No chats {agent ? `in ${agent.name} ` : ''}match {'“'}
              {trimmed}
              {'”'}
            </p>
          )}
        </Command.List>

        <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[9px] text-muted-foreground/50">
          <span>
            <kbd className="rounded bg-muted px-1 py-0.5 text-[8px]">{'↑↓'}</kbd> navigate
          </span>
          <span>
            <kbd className="rounded bg-muted px-1 py-0.5 text-[8px]">{'⏎'}</kbd> open
          </span>
          <span>
            <kbd className="rounded bg-muted px-1 py-0.5 text-[8px]">ESC</kbd> close
          </span>
        </div>
      </div>
    </>
  );
}

/**
 * One chat: its name and date, agent and branch, and why it matched. The
 * search's words are marked in the name. A tab whose own name lacks them
 * matched by its chat's name (the execution's title), which shows under it.
 * A message match shows its passage.
 */
function ChatResultItem({
  session,
  terms = [],
  matchedIn,
  snippet,
  onOpen,
}: {
  session: RailSession;
  /** The search's words, marked in the name. None in the recent list. */
  terms?: readonly string[];
  matchedIn?: 'title' | 'messages';
  snippet?: string | null;
  onOpen: (sessionId: string) => void;
}) {
  const label = sessionDisplayLabel(session);
  const placeholder = !(session.label ?? session.execution?.label);
  const chatTitle =
    matchedIn === 'title' &&
    session.label &&
    session.execution?.label &&
    !containsAllTerms(session.label, terms)
      ? session.execution.label
      : null;
  const archived = session.status === 'archived';
  const wsName = session.workspaceName ?? 'Agent removed';
  return (
    <Command.Item
      value={session.id}
      onSelect={() => onOpen(session.id)}
      className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 text-left data-[selected=true]:bg-muted/50"
    >
      <WorkspaceAvatar
        wsImage={coverAttachmentUrl(session.workspaceAttachments)}
        wsEmoji={session.workspaceEmoji}
        wsName={wsName}
      />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              'flex-1 truncate text-[12px]',
              placeholder ? 'italic text-muted-foreground/70' : 'font-medium text-foreground/90',
            )}
          >
            {placeholder ? label : <HighlightedText segments={highlightTerms(label, terms)} />}
          </span>
          <span className="flex-shrink-0 text-[9.5px] text-muted-foreground/60">
            {formatCompactRelative(sessionRankedAt(session))}
          </span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground/70">
          {archived && (
            <span className="flex-shrink-0 rounded bg-muted px-1 text-[8.5px] font-semibold uppercase tracking-wide">
              Archived
            </span>
          )}
          <span className="truncate">{wsName}</span>
          {session.branchName && (
            <span className="flex min-w-0 items-center gap-0.5 truncate">
              <GitBranch size={9} className="flex-shrink-0 opacity-60" />
              <span className="truncate">{session.branchName}</span>
            </span>
          )}
        </div>
        {chatTitle && (
          <p className="mt-0.5 truncate text-[9.5px] leading-snug text-muted-foreground/75">
            In <HighlightedText segments={highlightTerms(chatTitle, terms)} />
          </p>
        )}
        {snippet && <SearchSnippet snippet={snippet} />}
      </div>
    </Command.Item>
  );
}

/**
 * Which agent's chats to search. It sits beside the query rather than with
 * the facets under it because it narrows the recent list too, so it's there
 * before you type. The list filters as you type and takes arrows and Enter,
 * like the launcher's agent picker, and "All agents" at its top clears it.
 * Closing it puts focus back in the query, so arrows and Enter drive the
 * results again.
 */
function AgentFilter({
  agents,
  value,
  onChange,
  returnFocusTo,
}: {
  agents: readonly AgentOption[];
  value: AgentOption | null;
  onChange: (id: string | null) => void;
  returnFocusTo: RefObject<HTMLInputElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };

  // The launcher's popover content renders in-tree, inside the dialog's
  // scroll lock, so the list scrolls with a trackpad (launcher-popover.tsx).
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={value ? `Searching chats in ${value.name}. Change agent` : 'Search chats in one agent'}
          className={cn(
            'flex max-w-[11rem] flex-shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] transition-colors',
            value
              ? 'bg-muted/60 font-medium text-foreground hover:bg-muted'
              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
          )}
        >
          {value ? <AgentIcon agent={value} /> : <Bot size={12} className="flex-shrink-0" />}
          <span className="truncate">{value?.name ?? 'All agents'}</span>
          <ChevronDown size={11} className="flex-shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <LauncherPopoverContent
        align="end"
        className="w-64 p-0"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocusTo.current?.focus();
        }}
      >
        <Command loop defaultValue={value ? agentItemValue(value) : ALL_AGENTS} className="flex flex-col">
          <div className="flex items-center gap-1.5 border-b border-border px-2.5">
            <Search size={11} className="flex-shrink-0 text-muted-foreground/60" />
            <Command.Input
              placeholder="Find an agent…"
              className="h-8 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/50"
            />
          </div>
          <Command.List className="max-h-64 overflow-y-auto p-1">
            <Command.Empty className="px-2 py-3 text-center text-[11px] text-muted-foreground">
              No agent by that name
            </Command.Empty>
            <Command.Item
              value={ALL_AGENTS}
              onSelect={() => pick(null)}
              className={cn(AGENT_ITEM_CLASS, !value && 'font-medium text-foreground')}
            >
              <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                <Bot size={12} className="text-muted-foreground/70" />
              </span>
              All agents
            </Command.Item>
            {agents.map((w) => (
              <Command.Item
                key={w.id}
                value={agentItemValue(w)}
                onSelect={() => pick(w.id)}
                className={cn(AGENT_ITEM_CLASS, w.id === value?.id && 'font-medium text-foreground')}
              >
                <AgentIcon agent={w} />
                <span className="truncate">{w.name}</span>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </LauncherPopoverContent>
    </Popover>
  );
}

const ALL_AGENTS = 'All agents';

const AGENT_ITEM_CLASS =
  'flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-foreground/90 data-[selected=true]:bg-muted/70 data-[selected=true]:text-foreground';

/** Name plus id, so two agents with one name are still two items. */
function agentItemValue(agent: AgentOption): string {
  return `${agent.name} ${agent.id}`;
}

/** The agent's picture at chip size, drawn the way result rows draw it. */
function AgentIcon({ agent }: { agent: AgentOption }) {
  return (
    <WorkspaceAvatar
      size="sm"
      wsImage={coverAttachmentUrl(agent.attachments)}
      wsEmoji={agent.emoji}
      wsName={agent.name}
    />
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-0.5 rounded-md bg-muted/40 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          // Keep focus in the query, so arrows and Enter still drive the list.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(opt.value)}
          className={cn(
            'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
            value === opt.value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground/70 hover:text-foreground',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

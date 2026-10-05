'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Command } from 'cmdk';
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui';
import { GitBranch, Loader2, TextSearch, X } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useSessionSearch } from '@/hooks/use-session-search';
import { useHistorySessions } from '@/hooks/use-workspaces';
import { coverAttachmentUrl } from '@/lib/attachments/view';
import { executionView } from '@/lib/client/active-view';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import { sortSessionsHotnessDesc } from '@/lib/utils/session-sort';
import type { RailSession, SessionSearchFilters } from '@/lib/api/sessions';
import { cn } from '@/lib/utils';
import { SearchSnippet, WorkspaceAvatar, sessionDisplayLabel, sessionRankedAt } from './history-row';
import { closeChatSearch, useChatSearchOpen } from './chat-search-store';

type StatusFacet = 'all' | 'active' | 'archived';
type SourceFacet = 'all' | 'native' | 'imported';

/** How many recent chats an empty query shows. */
const RECENT_LIMIT = 8;

const GROUP_CLASS =
  'px-2 pb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[9px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground/60';

/**
 * Search every chat's transcript, in a modal. It used to be a box in the rail
 * that swapped the rail's body for results, which left a 256px column to read
 * snippets in and hid the agents you'd come back to. Here results get the
 * width, and the rail stays as it was.
 *
 * Same search and same controls as before: ranked by relevance (BM25), each
 * row with its date, agent, branch and a highlighted snippet, narrowed by
 * status (active / archived) and source (native / imported). With no query it
 * lists recent chats, so it doubles as a quick switcher. Arrows and Enter
 * open a chat. Opened from the rail's Search button or "Search chats" in ⌘K.
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
          Search the transcripts of every chat and execution, active or archived.
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
  const listRef = useRef<HTMLDivElement>(null);

  // Defer so we fire one request per settle, not per keystroke.
  const deferredQuery = useDeferredValue(query);
  const filters: SessionSearchFilters = {
    status: status === 'all' ? undefined : status,
    source: source === 'all' ? undefined : source,
  };
  const searching = query.trim().length > 0;
  const { data: results, isLoading, isFetching } = useSessionSearch(deferredQuery, filters);
  const { data: history } = useHistorySessions(!searching);

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
  const settling = searching && (deferredQuery !== query || isFetching);

  return (
    <>
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={closeChatSearch} />

      <div className="relative mx-auto mt-[15vh] w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <TextSearch size={16} className="flex-shrink-0 text-muted-foreground" />
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Search chats…"
            className="flex-1 border-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {settling && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
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
            ) : (
              <p className="p-8 text-center text-[11px] text-muted-foreground">
                Type to search what was said in every chat
              </p>
            )
          ) : hits.length > 0 ? (
            <Command.Group
              heading={`${hits.length} match${hits.length === 1 ? '' : 'es'}`}
              className={GROUP_CLASS}
            >
              {hits.map((r) => (
                <ChatResultItem key={r.id} session={r} snippet={r.snippet} onOpen={openChat} />
              ))}
            </Command.Group>
          ) : isLoading || settling ? (
            <p className="flex items-center justify-center gap-2 p-8 text-[11px] text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              Searching transcripts…
            </p>
          ) : (
            <p className="p-8 text-center text-[11px] text-muted-foreground">
              No chats match {'“'}
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

/** One chat: its name and date, agent and branch, and the matching line. */
function ChatResultItem({
  session,
  snippet,
  onOpen,
}: {
  session: RailSession;
  snippet?: string;
  onOpen: (sessionId: string) => void;
}) {
  const label = sessionDisplayLabel(session);
  const placeholder = !(session.label ?? session.execution?.label);
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
            {label}
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
        {snippet && <SearchSnippet snippet={snippet} />}
      </div>
    </Command.Item>
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

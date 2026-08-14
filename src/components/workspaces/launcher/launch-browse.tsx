'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowDownToLine,
  ChevronDown,
  CircleDot,
  GitBranch,
  GitPullRequest,
  Loader2,
  MessageSquare,
  Plug,
  Plus,
  Search,
  SquareCheckBig,
} from 'lucide-react';
import { ConnectorLogo } from '@/components/connectors/connector-logo';
import { openSettings } from '@/components/settings/settings-store';
import { DueBand, dueBand, dueLabel } from '@/lib/executions/task-rank';
import { cn } from '@/lib/utils';
import type { LaunchSourceItem, LaunchSourceKind } from '@/lib/executions/launch-draft';
import { useLaunchSources } from './use-launch-sources';
import {
  expand,
  fetchLimit,
  jumpLabel,
  nextExpandable,
  planRows,
  showMoreLabel,
  type PageState,
} from './launch-paging';

const KIND_ICON: Record<LaunchSourceKind, React.ComponentType<{ size?: number; className?: string }>> = {
  pr: GitPullRequest,
  issue: CircleDot,
  branch: GitBranch,
  task: SquareCheckBig,
  note: SquareCheckBig,
  connector: Plug,
  chat: MessageSquare,
  external: ArrowDownToLine,
};

const KIND_ICON_CLASS: Partial<Record<LaunchSourceKind, string>> = {
  pr: 'text-emerald-500/80',
  issue: 'text-emerald-500/80',
  connector: 'text-sky-500/80',
  external: 'text-amber-500/80',
};

interface BrowseTab {
  id: string;
  label: string;
  /** Empty means "everything" (the All tab). */
  kinds: LaunchSourceKind[];
  /** Only meaningful in a git workspace. */
  gitOnly?: boolean;
}

/**
 * Source tabs, ordered by how often each one actually starts a piece of work.
 *
 * Tasks leads because "work on the thing I wrote down" is the common case;
 * starting from a specific PR or branch is the specialist one. `All` stays
 * first and default since cross-source search is the reason the panel exists.
 *
 * There is deliberately NO "Connectors" tab. "Connector" is our word — a user
 * has *Todoist* tasks, not connector tasks — and lumping every provider under
 * one tab would bury Todoist under Linear, which is the same burying problem
 * a shared Tasks group already caused. Providers are instead a scope row
 * *inside* Tasks (see SCOPE_ALL), which keeps the tab bar from growing without
 * bound as accounts are added and matches how people actually name things.
 */
const TABS: BrowseTab[] = [
  { id: 'all', label: 'All', kinds: [] },
  { id: 'task', label: 'Tasks', kinds: ['task', 'connector'] },
  { id: 'pr', label: 'PRs', kinds: ['pr'], gitOnly: true },
  { id: 'issue', label: 'Issues', kinds: ['issue'], gitOnly: true },
  { id: 'branch', label: 'Branches', kinds: ['branch'], gitOnly: true },
  { id: 'chat', label: 'Chats', kinds: ['chat'] },
  { id: 'external', label: 'Import', kinds: ['external'] },
];

const SCOPE_ALL = 'all';
/** Scope value for tasks that live in this app rather than a connector. */
const SCOPE_LOCAL = 'local';

/** How close to the bottom of the list counts as "keep going". */
const AUTOLOAD_SLACK_PX = 64;

/**
 * The launcher's browse panel: one search field over every source, results
 * grouped by kind, arrow-key navigable.
 *
 * Owns its own query + cursor rather than lifting them, because the modal
 * above it only cares about the *pick*. Escape is handled here and stops
 * propagating so collapsing the panel doesn't also close the modal.
 *
 * With an empty query the groups fall back to recency, which makes the
 * panel browsable rather than requiring the user to guess a search term.
 */
export function LaunchBrowse({
  workspaceId,
  workspaceCwd,
  isGit,
  onPick,
  onClose,
}: {
  workspaceId: string | null;
  workspaceCwd: string | null;
  isGit: boolean;
  onPick: (item: LaunchSourceItem) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const now = useMemo(() => new Date(), []);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('all');
  const [scope, setScope] = useState(SCOPE_ALL);
  // "Dig deeper" for chats. Off by default so the common case — the work you
  // have going right now — isn't diluted by everything you ever finished.
  const [showArchivedChats, setShowArchivedChats] = useState(false);
  const [cursor, setCursor] = useState(0);
  // Pages revealed per group. Empty means "first page of everything", which is
  // what every change to the result set resets it back to.
  const [pages, setPages] = useState<PageState>({});
  const listRef = useRef<HTMLDivElement>(null);

  // Server-backed sources fetch to the depth the user has actually paged to,
  // so a resting panel stays as cheap as it was. Connector groups share one
  // limit because the endpoint applies it per provider — paging Todoist also
  // deepens Linear, which costs one extra provider call and keeps the wire
  // contract to a single number.
  const limits = useMemo(() => {
    const connectorPages = Math.max(
      1,
      ...Object.entries(pages)
        .filter(([id]) => id.startsWith('connector:'))
        .map(([, n]) => n),
    );
    return {
      task: fetchLimit(pages, 'task'),
      chat: fetchLimit(pages, 'chat'),
      connector: fetchLimit({ connector: connectorPages }, 'connector'),
    };
  }, [pages]);

  const { groups: allGroups, connectorSources, supportedSources } = useLaunchSources({
    workspaceId,
    workspaceCwd,
    query,
    enabled: true,
    isGit,
    includeArchivedChats: showArchivedChats,
    limits,
  });

  const tabs = useMemo(() => TABS.filter((t) => isGit || !t.gitOnly), [isGit]);
  const activeTab = tabs.find((t) => t.id === tab) ?? tabs[0];

  // The scope row is Tasks-only, and only earns its space when there's more
  // than one place tasks can come from. With no connectors it never appears.
  const scopes = useMemo(
    () =>
      connectorSources.length === 0
        ? []
        : [
            { id: SCOPE_ALL, label: 'All' },
            { id: SCOPE_LOCAL, label: 'This app' },
            ...connectorSources.map((s) => ({ id: s.toolkitId, label: s.providerLabel })),
          ],
    [connectorSources],
  );
  // Task providers we support but the user hasn't connected. Naming them beats
  // a bare "+": the CTA tells you what you'd gain before you click it.
  const connectMore = useMemo(() => {
    const connected = new Set(connectorSources.map((s) => s.toolkitId));
    return supportedSources.filter((s) => !connected.has(s.toolkitId));
  }, [supportedSources, connectorSources]);

  // The row shows on Tasks as a filter, and on All as a shortcut. On All the
  // All/This-app pills would be meaningless (narrowing "everything" to local
  // tasks isn't a thing you'd want), so only the provider marks appear there
  // and clicking one jumps to Tasks already scoped — one click to "just my
  // Todoist", from the default view.
  const isTaskTab = activeTab.id === 'task';
  const showScopeRow =
    (isTaskTab || activeTab.id === 'all') && (scopes.length > 0 || connectMore.length > 0);
  // Only on the Chats tab. On All it would be ambiguous (archived what?), and
  // the other tabs have no archived state to reveal. With a query typed it's
  // hidden rather than disabled: search already spans both, so a control that
  // couldn't change the results would just raise a question it can't answer.
  const showArchivedToggle = activeTab.id === 'chat' && query.trim().length < 2;
  const visibleScopes = isTaskTab ? scopes : scopes.filter((s) => s.id !== SCOPE_ALL && s.id !== SCOPE_LOCAL);
  const effectiveScope = isTaskTab && scopes.length > 0 ? scope : SCOPE_ALL;

  const selectScope = (id: string) => {
    if (!isTaskTab) setTab('task');
    setScope(id);
  };

  const groups = useMemo(() => {
    const byTab =
      activeTab.kinds.length === 0
        // On All, a group that resolved to nothing stays hidden — its
        // explanation is worth a row on its own tab, not next to six other
        // sources competing for the fold.
        ? allGroups.filter((g) => g.isLoading || g.error || g.items.length > 0)
        : allGroups.filter((g) => activeTab.kinds.includes(g.kind));
    if (effectiveScope === SCOPE_ALL) return byTab;
    if (effectiveScope === SCOPE_LOCAL) return byTab.filter((g) => g.kind !== 'connector');
    return byTab.filter((g) => g.toolkitId === effectiveScope);
  }, [allGroups, activeTab, effectiveScope]);

  const rendered = useMemo(() => planRows(groups, pages), [groups, pages]);

  // Flatten for keyboard traversal — the cursor walks rendered rows, so a
  // capped group can't leave the cursor pointing at something invisible.
  const flat = useMemo(() => rendered.flatMap((r) => r.shown), [rendered]);

  // The one group whose remaining rows can be revealed in place, if any. Also
  // what ArrowDown-at-the-end and scroll-to-bottom act on, so all three routes
  // to "keep going" agree on which list they're extending.
  const expandable = nextExpandable(rendered);
  const showMore = (groupId: string) => setPages((p) => expand(p, groupId));

  // A different result set starts over: the cursor goes home and every group
  // collapses back to one page, which also drops the deepened fetch limits.
  useEffect(() => {
    setCursor(0);
    setPages({});
  }, [query, tab, scope, showArchivedChats]);

  // Growing the list must NOT move the cursor — paging is the one case where
  // the row count changes while the user's place in it should not. Only clamp,
  // for when a slow source resolves to fewer rows than are already highlighted.
  useEffect(() => {
    setCursor((c) => (c < flat.length ? c : Math.max(0, flat.length - 1)));
  }, [flat.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // Reaching the bottom of a narrowed list is itself the request for more, so
  // scrolling there loads the next page. The in-flight guard matters for the
  // server-backed groups: resting at the bottom while a deeper fetch is on the
  // wire would otherwise queue a page per scroll event.
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > AUTOLOAD_SLACK_PX) return;
    if (!expandable || expandable.group.isFetching) return;
    showMore(expandable.group.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flat.length === 0) return;
      // At the end of a list that has more: extend it rather than wrapping.
      // The cursor deliberately stays put — the next press walks into the rows
      // that just appeared, and for a server-backed group they may not have
      // landed yet.
      if (cursor === flat.length - 1 && expandable) {
        showMore(expandable.group.id);
        return;
      }
      setCursor((c) => (c + 1) % flat.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (flat.length === 0 ? 0 : (c - 1 + flat.length) % flat.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flat[cursor];
      if (item) onPick(item);
    }
    // Escape is deliberately NOT handled here. Radix's dismissable layer
    // listens for it on the document, so stopping the React synthetic event
    // wouldn't prevent the whole modal from closing. The modal owns it via
    // `onEscapeKeyDown`, which collapses this panel only when focus is inside.
  };

  const anyLoading = groups.some((g) => g.isLoading);
  let rowIndex = -1;

  return (
    <div
      // Marks the panel so the modal can tell whether focus is inside it when
      // Escape fires — see the dialog's `onEscapeKeyDown`.
      data-launcher-browse=""
      className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-background/60"
    >
      <div className="relative flex-shrink-0 border-b border-border/70">
        <Search
          size={12}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
        />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search everything…"
          className="w-full bg-transparent py-2 pl-8 pr-3 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
        />
        {anyLoading && (
          <Loader2
            size={12}
            className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground/60"
          />
        )}
      </div>

      <div className="flex flex-shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/70 px-1.5 py-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'flex-shrink-0 rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
              t.id === activeTab.id
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Chats: reach finished work. Same pill shape as the task scope row so
          "narrow what this tab shows" reads as one idea in one place, and it
          says what it includes rather than what it filters — "Show archived"
          answers "where are my old chats", which is the question that got
          someone here. */}
      {showArchivedToggle && (
        <div className="flex flex-shrink-0 items-center gap-1 border-b border-border/70 px-1.5 py-1">
          <button
            type="button"
            onClick={() => setShowArchivedChats((prev) => !prev)}
            aria-pressed={showArchivedChats}
            className={cn(
              'inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition-colors',
              showArchivedChats
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            )}
          >
            <Archive size={10} />
            Show archived
          </button>
          <span className="truncate text-[10px] text-muted-foreground/60">
            Typing searches everything either way
          </span>
        </div>
      )}

      {/* Source scope. Connector pills are their brand mark alone until
          selected, which is what lets this row survive many connections:
          a labelled pill costs ~70px and overflows by the fourth provider,
          a mark costs ~24px and a dozen still fit. Brand marks are designed
          to be recognized at that size, and the group headers below spell
          the names out anyway. */}
      {showScopeRow && (
        <div className="flex flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-border/70 px-1.5 py-1">
          {visibleScopes.map((s) => {
            const isConnector = s.id !== SCOPE_ALL && s.id !== SCOPE_LOCAL;
            const selected = s.id === effectiveScope;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => selectScope(s.id)}
                title={isConnector ? (isTaskTab ? s.label : `Show ${s.label} tasks`) : undefined}
                aria-label={s.label}
                aria-pressed={selected}
                className={cn(
                  'inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border py-0.5 text-[10.5px] font-medium transition-colors',
                  isConnector && !selected ? 'px-1.5' : 'px-2',
                  selected
                    ? 'border-primary/40 bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                {isConnector && <ConnectorLogo providerId={s.id} name={s.label} size={12} />}
                {(!isConnector || selected) && s.label}
              </button>
            );
          })}

          {connectMore.length > 0 && (
            <button
              type="button"
              onClick={() => openSettings('connectors')}
              title={`Connect ${connectMore.map((s) => s.providerLabel).join(', ')}`}
              className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground transition-colors hover:border-solid hover:bg-muted/50 hover:text-foreground"
            >
              <Plus size={10} />
              {connectMore.length === 1 ? connectMore[0].providerLabel : connectMore.length}
            </button>
          )}
        </div>
      )}

      <div
        ref={listRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto p-1.5"
      >
        {groups.length === 0 && !anyLoading && (
          <div className="px-2 py-6 text-center text-[11px] italic text-muted-foreground/60">
            {/* Label verbatim — lowercasing turns "PRs" into "prs". */}
            {activeTab.kinds.length === 0
              ? 'Nothing matched. Your prompt alone is enough to start.'
              : `No ${activeTab.label} matched.`}
          </div>
        )}

        {/* Tasks with nothing connected: name the capability rather than
            leaving it invisible. Someone who has never opened connector
            settings has no way to learn this list can span Todoist/Linear. */}
        {activeTab.id === 'task' && connectorSources.length === 0 && !anyLoading && (
          <button
            type="button"
            onClick={() => openSettings('connectors')}
            className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[10.5px] text-muted-foreground/80 transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <Plug size={11} className="flex-shrink-0 text-sky-500/70" />
            Connect {connectMore.map((s) => s.providerLabel).join(', ')} to pull tasks in from there
          </button>
        )}

        {rendered.map(({ group, shown, hidden, more }) => (
          <div key={group.id} className="mb-1.5 last:mb-0">
            <div className="flex items-center gap-1.5 px-2 py-1">
              {group.toolkitId && (
                <ConnectorLogo providerId={group.toolkitId} name={group.label} size={11} />
              )}
              <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
                {group.label}
              </span>
              {group.isLoading && (
                <Loader2 size={9} className="animate-spin text-muted-foreground/50" />
              )}
              {/* Disk transcripts are cached for five minutes because the scan
                  is expensive, but the single most likely reason to open this
                  group is "I just finished a session and want it here". A
                  manual rescan is the escape hatch for that window. */}
              {group.kind === 'external' && !group.isLoading && (
                <button
                  type="button"
                  onClick={() => qc.invalidateQueries({ queryKey: ['imports', 'external-agents'] })}
                  className="ml-1 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                  Rescan
                </button>
              )}
            </div>

            {group.error ? (
              <div className="px-2 pb-1.5 text-[10.5px] text-muted-foreground/70">
                <span className="text-destructive">{group.error}</span>
                {group.emptyHint && <span> {group.emptyHint}</span>}
              </div>
            ) : group.isLoading && shown.length === 0 ? (
              // A slow source used to render as a bare header, which is
              // indistinguishable from "there's nothing here". Say what's
              // happening instead — the provider-history scan can take a
              // while on a busy machine.
              <div className="px-2 pb-1.5 text-[10.5px] italic text-muted-foreground/60">
                Searching…
              </div>
            ) : shown.length === 0 ? (
              <div className="px-2 pb-1.5 text-[10.5px] italic text-muted-foreground/60">
                {group.emptyHint ?? 'Nothing here.'}
              </div>
            ) : (
              shown.map((item) => {
                rowIndex++;
                const active = rowIndex === cursor;
                const Icon = KIND_ICON[item.kind];
                const index = rowIndex;
                const due = dueLabel(item.due, now);
                const band = dueBand(item.due, now);
                return (
                  <button
                    key={`${item.kind}:${item.key}`}
                    type="button"
                    data-active={active}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => onPick(item)}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                      active ? 'bg-muted' : 'hover:bg-muted/50',
                    )}
                  >
                    {item.toolkitId ? (
                      <span className="mt-0.5 flex-shrink-0">
                        <ConnectorLogo
                          providerId={item.toolkitId}
                          name={item.providerLabel ?? item.toolkitId}
                          size={12}
                        />
                      </span>
                    ) : (
                      <Icon
                        size={12}
                        className={cn('mt-0.5 flex-shrink-0', KIND_ICON_CLASS[item.kind] ?? 'text-muted-foreground/70')}
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-1.5">
                        {item.number != null && (
                          <span className="flex-shrink-0 font-mono text-[10px] text-muted-foreground/70">
                            #{item.number}
                          </span>
                        )}
                        <span
                          className={cn(
                            'truncate text-[12px] text-foreground',
                            item.kind === 'branch' && 'font-mono',
                          )}
                        >
                          {item.title}
                        </span>
                        {/* Picking one of these reactivates it, which is a
                            bigger thing than opening a live chat. Say so on the
                            row rather than after the fact. */}
                        {item.archived && (
                          <span className="flex-shrink-0 rounded-sm bg-muted px-1 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground/80">
                            archived
                          </span>
                        )}
                      </span>
                      {(due || item.subtitle) && (
                        <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                          {/* The sort key, made visible. An ordered list whose
                              ordering can't be seen reads as arbitrary. */}
                          {due && (
                            <span
                              className={cn(
                                'flex-shrink-0 font-medium',
                                band === DueBand.Overdue
                                  ? 'text-rose-500'
                                  : band === DueBand.Today
                                    ? 'text-amber-500'
                                    : 'text-muted-foreground/70',
                              )}
                            >
                              {due}
                            </span>
                          )}
                          {due && item.subtitle && <span className="opacity-40">·</span>}
                          {item.subtitle && <span className="truncate">{item.subtitle}</span>}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })
            )}

            {/* Sharing the list with other sources: the rest of this one is a
                tab away, not a page away. */}
            {more === 'jump' && (
              <button
                type="button"
                onClick={() => {
                  // Jump to the tab that owns this group. Connector groups all
                  // live under Tasks, so also scope to that provider — the
                  // click means "show me the rest of THIS list".
                  const owner = tabs.find((t) => t.kinds.includes(group.kind));
                  if (owner) setTab(owner.id);
                  // Narrowing to exactly this source is what gives it the whole
                  // list: a connector scopes to its toolkit, local tasks to
                  // "This app".
                  setScope(
                    group.toolkitId ?? (group.kind === 'task' ? SCOPE_LOCAL : SCOPE_ALL),
                  );
                }}
                className="w-full rounded-md px-2 py-1 text-left text-[10.5px] text-muted-foreground/70 transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                {jumpLabel(hidden, group.truncated, group.label)}
              </button>
            )}

            {/* This source owns the list, so the rest of it arrives here. */}
            {more === 'page' && (
              <button
                type="button"
                onClick={() => showMore(group.id)}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[10.5px] font-medium text-muted-foreground/80 transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                {group.isFetching ? (
                  <Loader2 size={10} className="flex-shrink-0 animate-spin" />
                ) : (
                  <ChevronDown size={10} className="flex-shrink-0" />
                )}
                {showMoreLabel(hidden, group.truncated)}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-shrink-0 items-center gap-3 border-t border-border/70 px-2.5 py-1.5 text-[9.5px] text-muted-foreground/60">
        <span>↑↓ move</span>
        <span>⏎ attach</span>
        <span>esc close</span>
      </div>
    </div>
  );
}

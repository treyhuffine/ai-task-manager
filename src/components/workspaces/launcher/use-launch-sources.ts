'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  useWorkspacePRs,
  useWorkspaceIssues,
  useWorkspaceBranches,
  useWorkspaceSessions,
} from '@/hooks/use-workspaces';
import { sessionsApi } from '@/lib/api/sessions';
import { tasksApi } from '@/lib/api/tasks';
import { api } from '@/lib/api/client';
import { stripHighlight } from '@/lib/search/highlight';
import type { LaunchSourceItem, LaunchSourceKind } from '@/lib/executions/launch-draft';
import type { ExternalAgentDiscovery } from '@/lib/import/types';
import type { ConnectorTaskResult } from '@/lib/connectors/task-sources';

/** Shared with the settings Imports panel so the two never double-scan. */
const DISCOVERY_KEY = ['imports', 'external-agents'] as const;

/**
 * The two or three ambient chips on the launcher's "Start from" row.
 *
 * Deliberately NOT `useLaunchSources` with an empty query: that hook pulls
 * in provider discovery, which walks every agent's history directory and can
 * take tens of seconds. Modal-open must stay instant, so the resting state
 * only reads caches that are already warm (open PRs) plus one small task
 * query. The expensive scan waits until the user actually opens browse.
 */
export function useLaunchSuggestions({
  workspaceId,
  isGit,
  enabled,
}: {
  workspaceId: string | null;
  isGit: boolean;
  enabled: boolean;
}): LaunchSourceItem[] {
  const prs = useWorkspacePRs(enabled && isGit ? workspaceId : null);
  const tasks = useQuery({
    queryKey: ['launcher', 'suggested-tasks', workspaceId],
    queryFn: () => tasksApi.list({ status: 'active', workspaceId: workspaceId ?? undefined, limit: 2 }),
    enabled,
    staleTime: 30_000,
  });

  return useMemo(() => {
    const items: LaunchSourceItem[] = [];
    for (const p of (prs.data ?? []).slice(0, 2)) {
      items.push({
        kind: 'pr',
        key: String(p.number),
        number: p.number,
        title: p.title,
        ref: p.headRefName,
      });
    }
    for (const t of tasks.data ?? []) {
      items.push({
        kind: 'task',
        key: t.id,
        title: t.title,
        body: t.body ?? t.description ?? null,
      });
    }
    return items.slice(0, 3);
  }, [prs.data, tasks.data]);
}

export interface LaunchSourceGroup {
  /** Unique per group. Distinct from `kind` because every connected connector
   *  gets its OWN group (`connector:todoist`) rather than sharing one. */
  id: string;
  kind: LaunchSourceKind;
  label: string;
  /** Set on connector groups — drives the per-provider scope filter + logo. */
  toolkitId?: string;
  items: LaunchSourceItem[];
  isLoading: boolean;
  /** Non-fatal: `gh` missing, repo has no remote, provider dirs absent. */
  error: string | null;
  /** Rendered instead of the rows when the group resolves to nothing. */
  emptyHint?: string;
  /**
   * Survive the empty-group filter so `emptyHint` can actually be seen.
   * Without this a group that resolved to "nothing, and here's why" is
   * indistinguishable from a group that was never asked — the exact failure
   * that made a fully-imported workspace look broken.
   */
  keepWhenEmpty?: boolean;
}

export interface LaunchSourcesResult {
  groups: LaunchSourceGroup[];
  /** Connected task providers, for the Tasks scope row. Stable across queries. */
  connectorSources: { toolkitId: string; providerLabel: string }[];
  /** Every task provider we support, for the "connect more" CTA. */
  supportedSources: { toolkitId: string; providerLabel: string }[];
}

function matches(query: string, ...fields: (string | number | null | undefined)[]): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return fields.some((f) => f != null && String(f).toLowerCase().includes(q));
}

function errorMessage(err: unknown): string | null {
  if (!err) return null;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Every launch source, normalized into one shape and filtered by one query.
 *
 * Two fetch strategies live side by side on purpose:
 *
 *   - **List-then-filter** (PRs, issues, branches): already-cached whole
 *     lists behind the existing hooks, filtered client-side. Typing costs
 *     nothing and results are instant.
 *   - **Query-the-server** (tasks, chats): unbounded corpora, so the query
 *     goes down the wire. Chat search is FTS-backed and needs a term, so
 *     that group simply doesn't exist until the user types.
 *
 * The external-agent group reuses the settings panel's discovery cache key
 * verbatim. That scan is slow (it walks every provider's history directory),
 * so it is `enabled`-gated to when the browse panel is actually open, and
 * whichever surface asks first warms it for the other.
 */
export function useLaunchSources({
  workspaceId,
  workspaceCwd,
  query,
  enabled,
  isGit,
}: {
  workspaceId: string | null;
  workspaceCwd: string | null;
  query: string;
  /** False while the browse panel is collapsed — keeps the scans from firing. */
  enabled: boolean;
  isGit: boolean;
}): LaunchSourcesResult {
  const trimmed = query.trim();
  const gitEnabled = enabled && isGit;
  const prs = useWorkspacePRs(gitEnabled ? workspaceId : null);
  const issues = useWorkspaceIssues(gitEnabled ? workspaceId : null);
  const branches = useWorkspaceBranches(gitEnabled ? workspaceId : null);

  const tasks = useQuery({
    queryKey: ['launcher', 'tasks', trimmed],
    queryFn: () =>
      tasksApi.list({
        status: 'active',
        q: trimmed || undefined,
        limit: 8,
        // Explicit: the user's drag order is the ordering here.
        orderBy: 'sortKey',
      }),
    enabled,
    staleTime: 15_000,
  });

  const chats = useQuery({
    queryKey: ['launcher', 'chats', workspaceId, trimmed],
    queryFn: () => sessionsApi.search(trimmed, { workspaceId: workspaceId ?? undefined, limit: 6 }),
    // FTS needs a term. Below two characters the index returns noise.
    enabled: enabled && trimmed.length >= 2,
    staleTime: 15_000,
  });

  // With no search term there is nothing to full-text match, but "the chat I
  // was just in" is the most likely thing you want. This is the workspace's
  // executions by recency — the same list the rail renders, so it's already
  // cached — and it keeps the Chats group from looking broken until you guess
  // a keyword. Only user and agent messages are indexed for FTS, so search
  // reaches far less than this list implies.
  const recentChats = useWorkspaceSessions(enabled ? workspaceId : null);

  const discovery = useQuery({
    queryKey: DISCOVERY_KEY,
    queryFn: () => api.get<ExternalAgentDiscovery>('/imports/agents', { timeoutMs: 120_000 }),
    enabled,
    // The scan walks every provider's history directory — ~4s in production,
    // but 50s+ against a loaded dev server. A 30s stale window meant refetching
    // an expensive scan almost every time the panel opened, and racing the
    // client timeout. Five minutes is well inside "the transcripts on disk
    // haven't meaningfully changed".
    staleTime: 5 * 60_000,
    retry: 1,
  });

  // Live reads from connected task providers. Hits the network per query, so
  // it's debounced by the same trimmed-query key the other server-side sources
  // use. Returns an empty payload (not an error) when nothing is connected.
  const connectorTasks = useQuery({
    queryKey: ['launcher', 'connector-tasks', trimmed],
    queryFn: () =>
      api.get<ConnectorTaskResult>('/connectors/tasks', {
        query: trimmed ? { q: trimmed } : undefined,
        timeoutMs: 20_000,
      }),
    enabled,
    staleTime: 30_000,
  });

  return useMemo(() => {
    const groups: LaunchSourceGroup[] = [];

    if (isGit) {
      groups.push({
        id: 'pr',
        kind: 'pr',
        label: 'Pull requests',
        isLoading: prs.isLoading,
        error: errorMessage(prs.error),
        emptyHint: 'Needs gh installed and authenticated.',
        items: (prs.data ?? [])
          .filter((p) => matches(trimmed, p.title, p.number, p.headRefName, p.author.login))
          .slice(0, 6)
          .map((p) => ({
            kind: 'pr' as const,
            key: String(p.number),
            number: p.number,
            title: p.title,
            subtitle: `${p.headRefName} → ${p.baseRefName} · @${p.author.login}${p.isDraft ? ' · draft' : ''}`,
            ref: p.headRefName,
          })),
      });

      groups.push({
        id: 'issue',
        kind: 'issue',
        label: 'Issues',
        isLoading: issues.isLoading,
        error: errorMessage(issues.error),
        emptyHint: 'Needs gh installed and authenticated.',
        items: (issues.data ?? [])
          .filter((i) => matches(trimmed, i.title, i.number, i.author.login))
          .slice(0, 6)
          .map((i) => ({
            kind: 'issue' as const,
            key: String(i.number),
            number: i.number,
            title: i.title,
            subtitle: `@${i.author.login}${i.labels.length ? ` · ${i.labels.slice(0, 2).map((l) => l.name).join(', ')}` : ''}`,
          })),
      });

      groups.push({
        id: 'branch',
        kind: 'branch',
        label: 'Branches',
        isLoading: branches.isLoading,
        error: errorMessage(branches.error),
        items: (branches.data ?? [])
          .filter((b) => matches(trimmed, b))
          // With no query, a repo's full branch list is noise. Show a few
          // as a hint that the group exists and let the query do the work.
          .slice(0, trimmed ? 6 : 3)
          .map((b) => ({
            kind: 'branch' as const,
            key: b,
            title: b,
            ref: b,
          })),
      });
    }

    groups.push({
      id: 'task',
      kind: 'task',
      label: 'Your tasks',
      isLoading: tasks.isLoading,
      error: errorMessage(tasks.error),
      // NOT re-ranked. `sortKey` is a fractional index the user sets by
      // dragging tasks into priority buckets, so it is an *explicit* statement
      // of what matters — which beats the due-date heuristic the connectors
      // get ranked by. Those providers give us no comparable signal, so they
      // get inferred urgency; here we'd be overriding the user with a guess.
      // The due badge still renders, so an overdue item is visible without
      // being silently promoted past something deliberately placed above it.
      items: (tasks.data ?? []).map((t) => ({
        kind: 'task' as const,
        key: t.id,
        title: t.title,
        subtitle: t.effort ? `${t.effort} effort` : null,
        body: t.body ?? t.description ?? null,
        due: t.hardDeadline ?? null,
      })),
    });

    // One group per connected provider, not one lumped "Connected tools".
    // Separate groups are what let a specific provider be reachable at all:
    // merged, Todoist sat below every local task and fell under the fold.
    const connectorItems = connectorTasks.data?.items ?? [];
    const connectorFailures = connectorTasks.data?.failures ?? [];
    const connectorSources = connectorTasks.data?.sources ?? [];
    const failureFor = new Map(connectorFailures.map((f) => [f.toolkitId, f.error]));

    if (connectorSources.length === 0 && connectorTasks.isLoading) {
      groups.push({
        id: 'connector:loading',
        kind: 'connector',
        label: 'Connected tools',
        isLoading: true,
        error: null,
        items: [],
      });
    }

    for (const source of connectorSources) {
      const rows = connectorItems.filter((t) => t.toolkitId === source.toolkitId);
      const failure = failureFor.get(source.toolkitId) ?? null;
      // A connected provider keeps its group even when it matches nothing, so
      // its scope chip always has somewhere to land.
      groups.push({
        id: `connector:${source.toolkitId}`,
        kind: 'connector',
        label: source.providerLabel,
        toolkitId: source.toolkitId,
        isLoading: connectorTasks.isLoading,
        error: errorMessage(connectorTasks.error) ?? failure,
        // Already ranked server-side (before truncation, so the most urgent
        // survive the per-provider limit) — preserved as-is here.
        items: rows.map((t) => ({
          kind: 'connector' as const,
          key: t.key,
          title: t.title,
          subtitle: t.subtitle,
          body: t.body,
          providerLabel: t.providerLabel,
          toolkitId: t.toolkitId,
          due: t.due,
        })),
      });
    }

    {
      const searching = trimmed.length >= 2;
      const chatItems: LaunchSourceItem[] = searching
        ? (chats.data ?? []).map((c) => ({
            kind: 'chat' as const,
            key: c.id,
            sessionId: c.id,
            archived: c.status === 'archived',
            title: c.label ?? c.execution?.label ?? 'Untitled chat',
            subtitle: stripHighlight(c.snippet),
          }))
        : (recentChats.data ?? []).slice(0, 8).map((c) => ({
            kind: 'chat' as const,
            key: c.id,
            sessionId: c.id,
            archived: c.status === 'archived',
            title: c.execution?.label ?? c.label ?? 'Untitled chat',
            subtitle: c.branchName ?? null,
          }));
      groups.push({
        id: 'chat',
        kind: 'chat',
        label: searching ? 'Chats' : 'Recent chats',
        isLoading: searching ? chats.isLoading : recentChats.isLoading,
        error: errorMessage(searching ? chats.error : recentChats.error),
        keepWhenEmpty: true,
        emptyHint: searching
          ? 'No chat matched. Search covers your and the agent\u2019s messages, not tool output.'
          : 'No chats in this workspace yet.',
        items: chatItems,
      });
    }

    // Provider sessions that ran in THIS checkout and aren't in Flow yet.
    // Scoped by cwd because "resume the Claude session I just ran in this
    // repo" is the case worth surfacing here; the cross-machine bulk
    // migration stays in Settings → Imports where it belongs.
    const externalItems: LaunchSourceItem[] = [];
    if (workspaceCwd) {
      for (const project of discovery.data?.projects ?? []) {
        // KNOWN GAP (deliberate, 2026-07-29): exact-path match only, so this
        // offers transcripts recorded at the repo root and nothing else.
        // Sessions an agent ran inside a *worktree* — this app's own
        // `.work/worktrees/<slug>/…`, or a third-party tool's like Conductor's
        // `conductor/workspaces/<repo>/<name>` — are never listed here even
        // though discovery returns them.
        //
        // Not fixed because the obvious approaches don't survive contact:
        // worktree directories are deleted when their execution is archived,
        // so git can't resolve them after the fact; and `prRepository` (the one
        // durable repo id in a Claude transcript) appears in ~4% of files.
        // The workable shape is "rank, don't filter" — surface everything with
        // paths we can attribute first, rest below with their path shown —
        // which also needs `ensureImportWorkspace` widened, since it uses this
        // same equality to decide where an import lands and would otherwise
        // mint a new workspace named after the worktree.
        if (project.cwd !== workspaceCwd) continue;
        for (const session of project.sessions) {
          if (session.imported) continue;
          if (!matches(trimmed, session.label, session.branchName)) continue;
          externalItems.push({
            kind: 'external',
            key: session.key,
            externalKey: session.key,
            externalSource: session.source,
            title: session.label,
            subtitle: `${session.source} · not yet imported`,
          });
        }
      }
    }
    // Always pushed. An empty result has three very different meanings —
    // still scanning, the scan failed, or everything here is already imported
    // — and collapsing them into "the group isn't there" is what makes a slow
    // or failed scan read as "you have nothing to import".
    {
      const scanned = !discovery.isLoading && !discovery.error;
      const sawAnyForWorkspace = (discovery.data?.projects ?? []).some(
        (p) => p.cwd === workspaceCwd && p.sessions.length > 0,
      );
      groups.push({
        id: 'external',
        kind: 'external',
        label: 'Not in Flow yet',
        isLoading: discovery.isLoading,
        error: errorMessage(discovery.error),
        keepWhenEmpty: true,
        emptyHint: !scanned
          ? undefined
          : sawAnyForWorkspace
            ? 'Every transcript for this workspace is already imported.'
            : 'No agent transcripts recorded for this folder yet.',
        // NOT truncated here. The shared row budget caps what's rendered and
        // emits a "+N more" affordance; slicing at the source hid 42 of 47
        // available transcripts with no indication they existed, which reads
        // as "there's nothing here" — the exact failure this group exists to
        // avoid.
        items: externalItems,
      });
    }

    // Sort into the same order the tabs are in. Groups are pushed in whatever
    // sequence is convenient (git first, because those queries are declared
    // first), which left Branches on top of the All list while the tab bar
    // said Tasks came first — two different answers to "what matters most".
    const order: LaunchSourceKind[] = [
      'task',
      'connector',
      'pr',
      'issue',
      'branch',
      'note',
      'chat',
      'external',
    ];
    const rank = (k: LaunchSourceKind) => {
      const i = order.indexOf(k);
      return i === -1 ? order.length : i;
    };

    return {
      groups: groups
        .filter((g) => g.isLoading || g.error || g.items.length > 0 || g.keepWhenEmpty)
        // Stable, so connectors keep their discovered order within their rank.
        .sort((a, b) => rank(a.kind) - rank(b.kind)),
      connectorSources,
      supportedSources: connectorTasks.data?.supported ?? [],
    };
  }, [
    isGit,
    trimmed,
    workspaceCwd,
    prs.data, prs.isLoading, prs.error,
    issues.data, issues.isLoading, issues.error,
    branches.data, branches.isLoading, branches.error,
    tasks.data, tasks.isLoading, tasks.error,
    chats.data, chats.isLoading, chats.error,
    recentChats.data, recentChats.isLoading, recentChats.error,
    discovery.data, discovery.isLoading, discovery.error,
    connectorTasks.data, connectorTasks.isLoading, connectorTasks.error,
  ]);
}

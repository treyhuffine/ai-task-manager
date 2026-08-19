'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  Folder,
  MessageSquare,
  RefreshCw,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type {
  ExternalAgentDiscovery,
  ExternalAgentImportResult,
  ExternalAgentProjectCandidate,
  ExternalAgentSessionCandidate,
  ExternalAgentSource,
} from '@/lib/import/types';

const DISCOVERY_KEY = ['imports', 'external-agents'] as const;

const SOURCES: readonly ExternalAgentSource[] = ['claude', 'codex', 'opencode'];

const SOURCE_META: Record<ExternalAgentSource, {
  label: string;
  mark: string;
  cardClassName: string;
  pillClassName: string;
}> = {
  claude: {
    label: 'Claude Code',
    mark: 'C',
    cardClassName: 'bg-orange-500/10 text-orange-500',
    pillClassName: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  },
  codex: {
    label: 'Codex',
    mark: 'O',
    cardClassName: 'bg-emerald-500/10 text-emerald-500',
    pillClassName: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  opencode: {
    label: 'OpenCode',
    mark: 'OC',
    cardClassName: 'bg-sky-500/10 text-sky-500',
    pillClassName: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  },
};

function sourceLabel(source: ExternalAgentSource): string {
  return SOURCE_META[source].label;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(date);
}

function selectableSessions(project: ExternalAgentProjectCandidate): ExternalAgentSessionCandidate[] {
  return project.sessions;
}

export function formatImportResultSummary(result: ExternalAgentImportResult): string {
  const outcomes: string[] = [];
  if (result.importedSessions > 0) {
    outcomes.push(
      `Imported ${result.importedSessions} ${result.importedSessions === 1 ? 'chat' : 'chats'} and ${result.importedEvents.toLocaleString()} events${result.createdWorkspaces > 0
        ? ` into ${result.createdWorkspaces} new ${result.createdWorkspaces === 1 ? 'project' : 'projects'}`
        : ''}`,
    );
  }
  if (result.syncedSessions > 0) {
    outcomes.push(
      `Synced ${result.syncedSessions} ${result.syncedSessions === 1 ? 'chat' : 'chats'} with ${result.syncedEvents.toLocaleString()} new events`,
    );
  }
  if (outcomes.length === 0) outcomes.push('No chats needed updating');
  if (result.skippedSessions > 0) {
    outcomes.push(`${result.skippedSessions} ${result.skippedSessions === 1 ? 'chat was' : 'chats were'} skipped`);
  }
  if (result.failures.length > 0) {
    outcomes.push(`${result.failures.length} could not be updated`);
  }
  return `${outcomes.join('. ')}.`;
}

export function hasExternalAgentDiscoveryRows(
  discovery: ExternalAgentDiscovery | undefined,
): boolean {
  return discovery?.projects.some((project) => project.sessions.length > 0) ?? false;
}

function importStatusLabel(session: ExternalAgentSessionCandidate): string {
  switch (session.importStatus) {
    case 'importing': return 'Updating';
    case 'changed': return 'Updates found';
    case 'missing': return 'Source missing';
    case 'error': return 'Sync failed';
    case 'current': return 'Imported';
    default: return formatDate(session.updatedAt);
  }
}

export function ExternalAgentImportPanel() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [lastResult, setLastResult] = useState<ExternalAgentImportResult | null>(null);
  const discovery = useQuery({
    queryKey: DISCOVERY_KEY,
    queryFn: () => api.get<ExternalAgentDiscovery>('/imports/agents', { timeoutMs: 60_000 }),
    staleTime: 30_000,
  });
  const importMutation = useMutation({
    mutationFn: (sessionKeys: string[]) => api.post<ExternalAgentImportResult>(
      '/imports/agents',
      { sessionKeys },
      { timeoutMs: 10 * 60_000 },
    ),
    onMutate: () => setLastResult(null),
    onSuccess: async (result) => {
      setLastResult(result);
      setSelected(new Set());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DISCOVERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['sessions', 'rail'] }),
        queryClient.invalidateQueries({ queryKey: ['sessions', 'history'] }),
      ]);
    },
  });

  const selectedProjects = useMemo(() => {
    if (!discovery.data) return 0;
    return discovery.data.projects.filter((project) => project.sessions.some((session) => selected.has(session.key))).length;
  }, [discovery.data, selected]);

  const selectedBreakdown = useMemo(() => {
    let imports = 0;
    let syncs = 0;
    for (const project of discovery.data?.projects ?? []) {
      for (const session of project.sessions) {
        if (!selected.has(session.key)) continue;
        if (session.imported) syncs += 1;
        else imports += 1;
      }
    }
    return { imports, syncs };
  }, [discovery.data, selected]);

  const toggleSession = (key: string) => {
    setLastResult(null);
    setSelected((prior) => {
      const next = new Set(prior);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleProject = (project: ExternalAgentProjectCandidate) => {
    setLastResult(null);
    const sessions = selectableSessions(project);
    const allSelected = sessions.length > 0 && sessions.every((session) => selected.has(session.key));
    setSelected((prior) => {
      const next = new Set(prior);
      for (const session of sessions) {
        if (allSelected) next.delete(session.key);
        else next.add(session.key);
      }
      return next;
    });
  };

  const toggleExpanded = (projectId: string) => {
    setExpanded((prior) => {
      const next = new Set(prior);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const refresh = () => {
    setLastResult(null);
    void discovery.refetch();
  };

  const hasRows = hasExternalAgentDiscoveryRows(discovery.data);

  const submitLabel = importMutation.isPending
    ? 'Updating...'
    : selectedBreakdown.imports > 0 && selectedBreakdown.syncs > 0
      ? `Import and sync ${selected.size} chats`
      : selectedBreakdown.syncs > 0
        ? `Sync ${selected.size} chats`
        : `Import ${selected.size || ''} chats`.replace('  ', ' ');

  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-3">
        {SOURCES.map((source) => {
          const summary = discovery.data?.sources[source];
          const meta = SOURCE_META[source];
          return (
            <div key={source} className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
              <div className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold',
                meta.cardClassName,
              )}>
                {meta.mark}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{sourceLabel(source)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {!summary
                    ? 'Checking local history'
                    : !summary.available
                      ? 'Local history unavailable'
                      : `${summary.found} chats found${summary.imported ? `, ${summary.imported} imported` : ''}`}
                </p>
              </div>
              {summary?.available && <CheckCircle2 size={15} className="text-emerald-500" />}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[12px] font-medium text-foreground">Local projects and chats</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground/85">
            Local agent history is read, never changed. An imported chat arrives as a
            read-only mirror that keeps syncing as the original session grows, and it
            runs in the project folder rather than a worktree if you continue it here.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={discovery.isFetching}>
          <RefreshCw className={cn(discovery.isFetching && 'animate-spin')} />
          Refresh list
        </Button>
      </div>

      {discovery.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((row) => <div key={row} className="h-16 animate-pulse rounded-lg bg-muted/50" />)}
        </div>
      ) : discovery.isError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Could not scan local agent history. {discovery.error instanceof Error ? discovery.error.message : ''}
        </div>
      ) : !hasRows ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <MessageSquare className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium text-foreground">No local chats found</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Flow checks Claude Code, Codex, and OpenCode history on this machine.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {discovery.data?.projects.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              selected={selected}
              expanded={expanded.has(project.id)}
              onToggleProject={() => toggleProject(project)}
              onToggleSession={toggleSession}
              onSyncSession={(key) => importMutation.mutate([key])}
              onToggleExpanded={() => toggleExpanded(project.id)}
              syncDisabled={importMutation.isPending}
              syncingSessionKey={importMutation.isPending && importMutation.variables?.length === 1
                ? importMutation.variables[0]
                : null}
            />
          ))}
        </div>
      )}

      {lastResult && (
        <div className={cn(
          'rounded-lg border p-3 text-[12px]',
          lastResult.failures.length > 0
            ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300'
            : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
        )}>
          {formatImportResultSummary(lastResult)}
        </div>
      )}

      {importMutation.isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[12px] text-destructive">
          Update failed. {importMutation.error instanceof Error ? importMutation.error.message : ''}
        </div>
      )}

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/95 pt-4 backdrop-blur">
        <p className="text-[11px] text-muted-foreground">
          {selected.size > 0
            ? `${selected.size} ${selected.size === 1 ? 'chat' : 'chats'} selected from ${selectedProjects} ${selectedProjects === 1 ? 'project' : 'projects'}. ${selectedBreakdown.imports} new, ${selectedBreakdown.syncs} to sync.`
            : 'Select a project or individual chats to import or sync.'}
        </p>
        <Button
          type="button"
          onClick={() => importMutation.mutate([...selected])}
          disabled={selected.size === 0 || importMutation.isPending}
        >
          <Download />
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

function ProjectRow({
  project,
  selected,
  expanded,
  onToggleProject,
  onToggleSession,
  onSyncSession,
  onToggleExpanded,
  syncDisabled,
  syncingSessionKey,
}: {
  project: ExternalAgentProjectCandidate;
  selected: Set<string>;
  expanded: boolean;
  onToggleProject: () => void;
  onToggleSession: (key: string) => void;
  onSyncSession: (key: string) => void;
  onToggleExpanded: () => void;
  syncDisabled: boolean;
  syncingSessionKey: string | null;
}) {
  const selectable = selectableSessions(project);
  const selectedCount = selectable.filter((session) => selected.has(session.key)).length;
  const checked = selectable.length > 0 && selectedCount === selectable.length;
  const checkState = checked ? true : selectedCount > 0 ? 'indeterminate' as const : false;
  const visibleSessions = expanded ? project.sessions : project.sessions.slice(0, 3);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-start gap-3 p-3">
        <Checkbox
          checked={checkState}
          onCheckedChange={onToggleProject}
          disabled={selectable.length === 0}
          aria-label={`Select ${project.name}`}
          className="mt-0.5"
        />
        <Folder size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
        <button type="button" onClick={onToggleExpanded} className="min-w-0 flex-1 text-left">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{project.name}</span>
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
              {project.sessions.length} {project.sessions.length === 1 ? 'chat' : 'chats'}
            </span>
          </span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground/70">{project.cwd}</span>
          {!project.pathExists && (
            <span className="mt-1 flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
              <AlertTriangle size={10} /> Folder missing. The chat can still be imported or synced.
            </span>
          )}
        </button>
        <button type="button" onClick={onToggleExpanded} aria-label={expanded ? 'Collapse chats' : 'Expand chats'}>
          <ChevronDown size={15} className={cn('text-muted-foreground transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>

      <div className="border-t border-border/70 bg-muted/10">
        {visibleSessions.map((session) => {
          const isSyncing = syncingSessionKey === session.key;
          return (
            <div
              key={session.key}
              className="flex items-center gap-3 border-b border-border/50 px-3 py-2 last:border-b-0 hover:bg-muted/30"
            >
              <Checkbox
                checked={selected.has(session.key)}
                onCheckedChange={() => onToggleSession(session.key)}
                disabled={syncDisabled}
                aria-label={`Select ${session.label} to ${session.imported ? 'sync' : 'import'}`}
              />
              <MessageSquare size={13} className="shrink-0 text-muted-foreground" />
              <button
                type="button"
                onClick={() => onToggleSession(session.key)}
                disabled={syncDisabled}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-[12px] text-foreground">{session.label}</span>
                <span className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className={cn(
                    'rounded-full px-1.5 py-0.5 font-medium',
                    SOURCE_META[session.source].pillClassName,
                  )}>
                    {sourceLabel(session.source)}
                  </span>
                  {session.branchName && <span className="max-w-36 truncate">{session.branchName}</span>}
                </span>
              </button>
              <span className={cn(
                'shrink-0 text-[10px] text-muted-foreground',
                session.importStatus === 'changed' && 'text-amber-600 dark:text-amber-400',
                session.importStatus === 'error' && 'text-destructive',
              )}>
                {importStatusLabel(session)}
              </span>
              {session.imported && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onSyncSession(session.key)}
                  disabled={syncDisabled}
                  className="h-7 gap-1 px-2 text-[10px]"
                  aria-label={`Sync ${session.label}`}
                >
                  <RefreshCw className={cn('size-3', isSyncing && 'animate-spin')} />
                  {isSyncing ? 'Syncing' : session.importStatus === 'error' || session.importStatus === 'missing' ? 'Retry' : 'Sync'}
                </Button>
              )}
            </div>
          );
        })}
        {!expanded && project.sessions.length > 3 && (
          <button type="button" onClick={onToggleExpanded} className="w-full px-3 py-2 text-[11px] font-medium text-primary hover:bg-muted/30">
            Show {project.sessions.length - 3} more chats
          </button>
        )}
      </div>
    </div>
  );
}

export function ImportsSection() {
  return <ExternalAgentImportPanel />;
}

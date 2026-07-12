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

function sourceLabel(source: ExternalAgentSource): string {
  return source === 'claude' ? 'Claude Code' : 'Codex';
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
  return project.sessions.filter((session) => !session.imported);
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

  const found = (discovery.data?.sources.claude.found ?? 0) + (discovery.data?.sources.codex.found ?? 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-2">
        {(['claude', 'codex'] as const).map((source) => {
          const summary = discovery.data?.sources[source];
          return (
            <div key={source} className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
              <div className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold',
                source === 'claude' ? 'bg-orange-500/10 text-orange-500' : 'bg-emerald-500/10 text-emerald-500',
              )}>
                {source === 'claude' ? 'C' : 'O'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{sourceLabel(source)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {!summary
                    ? 'Checking local history'
                    : !summary.available
                      ? 'Local folder not found'
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
            Flow reads the source folders without changing them. Imported chats remain available in History.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={discovery.isFetching}>
          <RefreshCw className={cn(discovery.isFetching && 'animate-spin')} />
          Scan again
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
      ) : found === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <MessageSquare className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium text-foreground">No local chats found</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Flow checks the configured Claude and Codex home folders on this machine.
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
              onToggleExpanded={() => toggleExpanded(project.id)}
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
          Imported {lastResult.importedSessions} chats and {lastResult.importedEvents.toLocaleString()} events
          {lastResult.createdWorkspaces > 0 ? ` into ${lastResult.createdWorkspaces} new projects` : ''}.
          {lastResult.skippedSessions > 0 ? ` ${lastResult.skippedSessions} were already imported.` : ''}
          {lastResult.failures.length > 0 ? ` ${lastResult.failures.length} could not be imported.` : ''}
        </div>
      )}

      {importMutation.isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[12px] text-destructive">
          Import failed. {importMutation.error instanceof Error ? importMutation.error.message : ''}
        </div>
      )}

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/95 pt-4 backdrop-blur">
        <p className="text-[11px] text-muted-foreground">
          {selected.size > 0
            ? `${selected.size} chats selected from ${selectedProjects} projects`
            : 'Select a project or individual chats to import.'}
        </p>
        <Button
          type="button"
          onClick={() => importMutation.mutate([...selected])}
          disabled={selected.size === 0 || importMutation.isPending}
        >
          <Download />
          {importMutation.isPending ? 'Importing...' : `Import ${selected.size || ''} chats`.replace('  ', ' ')}
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
  onToggleExpanded,
}: {
  project: ExternalAgentProjectCandidate;
  selected: Set<string>;
  expanded: boolean;
  onToggleProject: () => void;
  onToggleSession: (key: string) => void;
  onToggleExpanded: () => void;
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
              <AlertTriangle size={10} /> Folder missing. The transcript can still be imported.
            </span>
          )}
        </button>
        <button type="button" onClick={onToggleExpanded} aria-label={expanded ? 'Collapse chats' : 'Expand chats'}>
          <ChevronDown size={15} className={cn('text-muted-foreground transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>

      <div className="border-t border-border/70 bg-muted/10">
        {visibleSessions.map((session) => (
          <label key={session.key} className={cn(
            'flex items-center gap-3 border-b border-border/50 px-3 py-2 last:border-b-0',
            session.imported ? 'opacity-55' : 'cursor-pointer hover:bg-muted/30',
          )}>
            <Checkbox
              checked={session.imported || selected.has(session.key)}
              onCheckedChange={() => onToggleSession(session.key)}
              disabled={session.imported}
              aria-label={`Select ${session.label}`}
            />
            <MessageSquare size={13} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] text-foreground">{session.label}</span>
              <span className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className={cn(
                  'rounded-full px-1.5 py-0.5 font-medium',
                  session.source === 'claude'
                    ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
                    : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                )}>
                  {sourceLabel(session.source)}
                </span>
                {session.branchName && <span className="max-w-36 truncate">{session.branchName}</span>}
              </span>
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{session.imported ? 'Imported' : formatDate(session.updatedAt)}</span>
          </label>
        ))}
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

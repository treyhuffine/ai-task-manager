'use client';

import { DISCOVERY_KEY } from '@/components/settings/sections/imports-section';
import { openSettings } from '@/components/settings/settings-store';
import type { ExternalAgentDiscovery, ExternalAgentSource } from '@/lib/import/types';
import { trpcClient } from '@/lib/trpc/client';
import { rpcOptions } from '@/lib/trpc/request-options';
import { cn } from '@/lib/utils';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Folder, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { startImport, useImportRun } from './import-runner';
import { listJoin } from './onboarding-flow';
import { Card, PrimaryButton, QuietButton, Says } from './onboarding-ui';

const SOURCE_NAMES: Record<ExternalAgentSource, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
};

/** How many recent projects the step offers. The rest are in Settings, Imports. */
export const RECENT_PROJECT_LIMIT = 8;
/** Projects worked in this recently start ticked, at most `PRESELECT_MAX` of them. */
const PRESELECT_DAYS = 14;
const PRESELECT_MAX = 3;

export interface ImportableHistory {
  projects: number;
  chats: number;
  /** The tools it came from, by name, most first. */
  sources: string[];
}

export interface RecentProject {
  cwd: string;
  name: string;
  /** Sessions not in Ri yet. */
  sessionKeys: string[];
  /** Their titles, newest first. */
  titles: string[];
  sources: string[];
  lastActiveAt: string;
}

function openSessions(project: ExternalAgentDiscovery['projects'][number]) {
  return project.sessions.filter((s) => !s.imported && s.importable !== false);
}

/** What a discovery holds that isn't in Ri yet. Pure, for the step's wording and the tests. */
export function importableHistory(discovery: ExternalAgentDiscovery): ImportableHistory {
  let projects = 0;
  let chats = 0;
  const bySource = new Map<ExternalAgentSource, number>();
  for (const project of discovery.projects) {
    const open = openSessions(project);
    if (open.length === 0) continue;
    projects += 1;
    chats += open.length;
    for (const s of open) bySource.set(s.source, (bySource.get(s.source) ?? 0) + 1);
  }
  const sources = [...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([source]) => SOURCE_NAMES[source]);
  return { projects, chats, sources };
}

/**
 * The projects worth offering: still on disk, with chats not in Ri yet,
 * most recently worked in first. Pure, for the tests and the about draft.
 */
export function recentProjects(discovery: ExternalAgentDiscovery, limit = RECENT_PROJECT_LIMIT): RecentProject[] {
  const out: RecentProject[] = [];
  for (const project of discovery.projects) {
    if (!project.pathExists) continue;
    const open = openSessions(project).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (open.length === 0) continue;
    out.push({
      cwd: project.cwd,
      name: project.name,
      sessionKeys: open.map((s) => s.key),
      titles: open.map((s) => s.label).filter(Boolean),
      sources: [...new Set(open.map((s) => SOURCE_NAMES[s.source]))],
      lastActiveAt: open[0]!.updatedAt,
    });
  }
  return out.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt)).slice(0, limit);
}

/** The ones to start ticked: worked in within two weeks, the three most recent at most. */
export function preselectedProjects(projects: RecentProject[], now = Date.now()): string[] {
  const since = now - PRESELECT_DAYS * 24 * 60 * 60 * 1000;
  return projects
    .filter((p) => Date.parse(p.lastActiveAt) >= since)
    .slice(0, PRESELECT_MAX)
    .map((p) => p.cwd);
}

/**
 * This computer's history from other agent tools, looked for as soon as the
 * first run opens (it can take a while), under the same cache key as the
 * import panel so either shows what the other found.
 */
export function useImportDiscovery(enabled: boolean) {
  return useQuery({
    queryKey: [...DISCOVERY_KEY, 'here'],
    queryFn: () => trpcClient.imports.agentsGet.query({}, rpcOptions({ timeoutMs: 90_000 })),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** What the assistant asks at the import step. */
export function importQuestion(history: ImportableHistory | null): ReactNode {
  if (!history) {
    return <Says>Let me look for your history from Claude Code and Codex on this computer.</Says>;
  }
  return (
    <>
      <Says>
        I found your history on this computer: {plural(history.chats, 'chat')} across{' '}
        {plural(history.projects, 'project')} from {listJoin(history.sources)}.
      </Says>
      <Says>
        Want to bring in the ones you’re working on now? Each project becomes an agent, with its chats. It runs in
        the background, so we can keep going.
      </Says>
    </>
  );
}

/**
 * The import step: the recent projects, the latest few ticked. Bringing them
 * in starts the import in the background (`startImport`) and moves straight
 * on. It waits while the search runs, and finishes silently when there turns
 * out to be nothing.
 */
export function ImportStep({
  discovery,
  loading,
  onDone,
}: {
  discovery: ExternalAgentDiscovery | undefined;
  loading: boolean;
  onDone: (reply: string) => void;
}) {
  const qc = useQueryClient();
  const projects = discovery ? recentProjects(discovery) : [];
  // Null until the person touches a row: the pick follows what's recent.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const selected = picked ?? new Set(preselectedProjects(projects));

  // Nothing to bring in after all: move on without a word, once.
  const finished = useRef(false);
  useEffect(() => {
    if (finished.current || loading || !discovery || projects.length > 0) return;
    finished.current = true;
    onDone('');
  }, [loading, discovery, projects.length, onDone]);

  if (loading || !discovery) {
    return (
      <Card className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 size={12} className="animate-spin" /> Looking
        </span>
        <QuietButton onClick={() => onDone('Not now')}>Skip</QuietButton>
      </Card>
    );
  }

  const toggle = (cwd: string) => {
    const next = new Set(selected);
    if (next.has(cwd)) next.delete(cwd);
    else next.add(cwd);
    setPicked(next);
  };
  const chosen = projects.filter((p) => selected.has(p.cwd));
  const bringIn = () => {
    startImport(qc, {
      sessionKeys: chosen.flatMap((p) => p.sessionKeys),
      projects: chosen.map((p) => p.name),
    });
    onDone(`Bring in ${listJoin(chosen.map((p) => p.name))}`);
  };

  return (
    <Card>
      <div className="flex flex-col">
        {projects.map((project) => {
          const on = selected.has(project.cwd);
          return (
            <button
              key={project.cwd}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(project.cwd)}
              title={project.cwd}
              className="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-muted/50"
            >
              <span
                className={cn(
                  'flex size-4 flex-shrink-0 items-center justify-center rounded border',
                  on ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
                )}
              >
                {on && <Check size={11} />}
              </span>
              <Folder size={13} className="flex-shrink-0 text-muted-foreground/70" />
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-[12px] font-medium text-foreground">{project.name}</span>
                <span className="truncate text-[10.5px] text-muted-foreground">
                  {plural(project.sessionKeys.length, 'chat')} · {project.sources.join(', ')}
                </span>
              </span>
              <span className="flex-shrink-0 text-[10px] text-muted-foreground/70">
                {formatCompactRelative(project.lastActiveAt)}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => openSettings('imports')}
          className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Everything else, in Settings
        </button>
        <div className="flex items-center gap-1.5">
          <QuietButton onClick={() => onDone('Not now')}>Not now</QuietButton>
          <PrimaryButton disabled={chosen.length === 0} onClick={bringIn}>
            Bring in {plural(chosen.length, 'project')} <ArrowRight size={12} />
          </PrimaryButton>
        </div>
      </div>
    </Card>
  );
}

/** The background import's progress, under the conversation's newest message. */
export function ImportProgress() {
  const run = useImportRun();
  if (!run) return null;
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 self-start rounded-full border px-2.5 py-1 text-[11px]',
        run.status === 'failed' ? 'border-destructive/30 text-destructive' : 'border-border text-muted-foreground',
      )}
      aria-live="polite"
    >
      {run.status === 'running' ? (
        <>
          <Loader2 size={11} className="animate-spin" />
          Bringing in {plural(run.chats, 'chat')} from {listJoin(run.projects)}
        </>
      ) : run.status === 'done' ? (
        <>
          <Check size={11} className="text-emerald-500" />
          Brought in {plural(run.imported ?? run.chats, 'chat')} from {listJoin(run.projects)}
        </>
      ) : (
        <>Couldn’t bring those in: {run.error}</>
      )}
    </div>
  );
}

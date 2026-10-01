'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { DISCOVERY_KEY, ExternalAgentImportPanel } from '@/components/settings/sections/imports-section';
import type { ExternalAgentDiscovery, ExternalAgentSource } from '@/lib/import/types';
import { listJoin } from './onboarding-flow';
import { Card, PrimaryButton, QuietButton, Says } from './onboarding-ui';

const SOURCE_NAMES: Record<ExternalAgentSource, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
};

export interface ImportableHistory {
  projects: number;
  chats: number;
  /** The tools it came from, by name, most first. */
  sources: string[];
  /** Chats brought in so far, to tell what the step did. */
  imported: number;
}

/** What a discovery holds that isn't in Ri yet. Pure, for the step's wording and the tests. */
export function importableHistory(discovery: ExternalAgentDiscovery): ImportableHistory {
  let projects = 0;
  let chats = 0;
  const bySource = new Map<ExternalAgentSource, number>();
  for (const project of discovery.projects) {
    const open = project.sessions.filter((s) => !s.imported && s.importable !== false);
    if (open.length === 0) continue;
    projects += 1;
    chats += open.length;
    for (const s of open) bySource.set(s.source, (bySource.get(s.source) ?? 0) + 1);
  }
  const imported = Object.values(discovery.sources).reduce((n, s) => n + (s?.imported ?? 0), 0);
  const sources = [...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([source]) => SOURCE_NAMES[source]);
  return { projects, chats, sources, imported };
}

/**
 * This computer's history from other agent tools, looked for as soon as the
 * first run opens (it can take a while), under the same cache key as the
 * import panel so the step shows what was already found.
 */
export function useImportDiscovery(enabled: boolean) {
  return useQuery({
    queryKey: [...DISCOVERY_KEY, 'here'],
    queryFn: () => api.get<ExternalAgentDiscovery>('/imports/agents', { timeoutMs: 90_000 }),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** What the assistant says at the import step. */
export function importLines(history: ImportableHistory | null): ReactNode {
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
        Want to bring some in? Each project becomes an agent, and its chats come along, searchable and ready to
        pick up where you left off.
      </Says>
    </>
  );
}

/**
 * The import step: the same panel as Settings, Imports. It waits while the
 * search runs, and finishes silently when there turns out to be nothing.
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
  const history = discovery ? importableHistory(discovery) : null;
  // Chats already in Ri when the step appeared, so what it brought in shows.
  const [importedAtStart, setImportedAtStart] = useState<number | null>(null);
  if (history && importedAtStart === null) setImportedAtStart(history.imported);
  // Nothing to bring in after all: move on without a word, once.
  const finished = useRef(false);
  useEffect(() => {
    if (finished.current || loading || !history || history.chats > 0) return;
    finished.current = true;
    onDone('');
  }, [loading, history, onDone]);

  if (loading || !history) {
    return (
      <Card className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 size={12} className="animate-spin" /> Looking
        </span>
        <QuietButton onClick={() => onDone('Not now')}>Skip</QuietButton>
      </Card>
    );
  }

  const broughtIn = history.imported - (importedAtStart ?? history.imported);
  return (
    <Card>
      <div className="max-h-[22rem] overflow-y-auto">
        <ExternalAgentImportPanel />
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 border-t border-border pt-3">
        {broughtIn > 0 ? (
          <PrimaryButton onClick={() => onDone(`Brought in ${plural(broughtIn, 'chat')}`)}>
            Continue <ArrowRight size={12} />
          </PrimaryButton>
        ) : (
          <QuietButton onClick={() => onDone('Not now')}>Not now</QuietButton>
        )}
      </div>
    </Card>
  );
}

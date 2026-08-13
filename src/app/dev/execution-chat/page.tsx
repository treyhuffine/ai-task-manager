'use client';

/**
 * /dev/execution-chat — playground for the execution-chat surface.
 *
 * Left rail = scenario buttons grouped by category. Right pane = the
 * production `ExecutionView` rendered against a single, persistent
 * "scratch" session that the user keeps reusing.
 *
 * Why this page exists: AskUserQuestion and tool-permission prompts
 * are non-deterministic to trigger via real prompts (Claude often
 * answers from context instead of asking, or chooses a different
 * tool). The "Inject" button on each card writes pending-input
 * directly so the overlay/transcript renders deterministically. The
 * "Live" button sends a real prompt for end-to-end coverage.
 */

import { Suspense, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw, Beaker, Zap, RefreshCw } from 'lucide-react';
import { DashboardProvider } from '@/contexts/dashboard-context';
import { api, ApiError } from '@/lib/api/client';
import { sessionsApi, type ChatSessionWithAgent } from '@/lib/api/sessions';
import { ExecutionView } from '@/components/executions/execution-view';
import { PERMISSION_MODE_META } from '@/lib/permission-modes';
import { SCENARIOS, SCENARIO_CATEGORIES, type Scenario, type InjectBody } from '@/lib/dev/scenarios';
import type { WorkspaceRecord } from '@/db/types';
import { cn } from '@/lib/utils';

interface ScratchResponse {
  session: ChatSessionWithAgent;
  workspace: WorkspaceRecord;
}

export default function DevExecutionChatPage() {
  // Suspense boundary required: DashboardProvider reads useSearchParams.
  return (
    <Suspense fallback={null}>
      <DashboardProvider>
        <DevExecutionChatInner />
      </DashboardProvider>
    </Suspense>
  );
}

function DevExecutionChatInner() {
  const qc = useQueryClient();
  const { data: scratch, isLoading, error, refetch } = useQuery({
    queryKey: ['dev', 'scratch-session'],
    queryFn: () => api.get<ScratchResponse>('/dev/sessions/scratch'),
    staleTime: Infinity,
  });

  const sessionId = scratch?.session.id ?? null;

  const inject = useMutation({
    mutationFn: ({ id, body }: { id: string; body: InjectBody }) =>
      api.post<{ ok: true }>(`/dev/sessions/${id}/inject`, body),
    onSuccess: () => {
      if (!sessionId) return;
      // Both event and pending-input change on inject — tickle both.
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'events'] });
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'pending-input'] });
    },
  });

  const live = useMutation({
    mutationFn: async ({ id, mode, prompt }: {
      id: string; mode: Scenario['live'] extends infer T ? T extends { mode: infer M } ? M : never : never; prompt: string;
    }) => {
      // Match the mode the scenario expects, then send the prompt.
      // PATCH is idempotent — same mode = no-op so this stays cheap.
      await sessionsApi.update(id, { permissionMode: mode });
      await sessionsApi.sendMessage(id, prompt);
    },
    onSuccess: () => {
      if (!sessionId) return;
      qc.invalidateQueries({ queryKey: ['session', sessionId] });
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'events'] });
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'runtime-status'] });
    },
  });

  const reset = useMutation({
    mutationFn: (id: string) =>
      api.post<{ ok: true }>(`/dev/sessions/${id}/inject`, { kind: 'reset_session' }),
    onSuccess: () => {
      if (!sessionId) return;
      qc.invalidateQueries({ queryKey: ['session', sessionId] });
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'events'] });
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'pending-input'] });
    },
  });

  const grouped = useMemo(() => {
    const map = new Map<string, Scenario[]>();
    for (const s of SCENARIOS) {
      const list = map.get(s.category) ?? [];
      list.push(s);
      map.set(s.category, list);
    }
    return map;
  }, []);

  const [lastFired, setLastFired] = useState<{ id: string; via: 'inject' | 'live' } | null>(null);

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !scratch) {
    return (
      <div className="h-screen flex items-center justify-center text-center px-8">
        <div>
          <p className="text-[12px] font-semibold text-foreground">
            Couldn&apos;t load the scratch session.
          </p>
          <p className="text-[11px] text-muted-foreground/80 mt-1">
            {error instanceof ApiError ? error.message : 'Unknown error.'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[11px] font-medium text-primary hover:bg-primary/10"
          >
            <RefreshCw size={11} /> Retry
          </button>
        </div>
      </div>
    );
  }

  const fireInject = (s: Scenario) => {
    if (!s.inject || !sessionId) return;
    setLastFired({ id: s.id, via: 'inject' });
    inject.mutate({ id: sessionId, body: s.inject });
  };

  const fireLive = (s: Scenario) => {
    if (!s.live || !sessionId) return;
    setLastFired({ id: s.id, via: 'live' });
    live.mutate({ id: sessionId, mode: s.live.mode, prompt: s.live.prompt });
  };

  const modeMeta = PERMISSION_MODE_META[scratch.session.permissionMode];

  return (
    <div className="h-screen flex bg-background">
      {/* ─── Left rail ─────────────────────────────────── */}
      <aside className="w-[340px] flex-shrink-0 flex flex-col border-r border-border bg-muted/20">
        <header className="px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Beaker size={14} className="text-primary" />
            <span className="text-[12px] font-semibold text-foreground">
              execution-chat playground
            </span>
          </div>
          <p className="text-[10.5px] text-muted-foreground/80 mt-1 leading-snug">
            Inject = synthetic state, no agent call. Live = real prompt + agent dispatch.
          </p>
          <div className="flex items-center gap-2 mt-2 text-[10px]">
            <span className={cn('px-1.5 py-0.5 rounded border font-medium', modeMeta.classes.text, modeMeta.classes.border, modeMeta.classes.bg)}>
              {modeMeta.shortTitle}
            </span>
            <span className="text-muted-foreground/70 truncate font-mono">
              {scratch.session.id.slice(0, 8)}…
            </span>
            <button
              onClick={() => sessionId && reset.mutate(sessionId)}
              disabled={!sessionId || reset.isPending}
              className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
              title="Wipe transcript + clear pending"
            >
              {reset.isPending ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <RotateCcw size={10} />
              )}
              Reset
            </button>
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {SCENARIO_CATEGORIES.map((cat) => {
            const items = grouped.get(cat.id) ?? [];
            if (items.length === 0) return null;
            return (
              <section key={cat.id} className="border-b border-border/50">
                <div className="px-4 py-2 flex items-baseline gap-2 sticky top-0 bg-muted/40 backdrop-blur-sm">
                  <h2 className="text-[10px] uppercase tracking-wider font-semibold text-foreground/80">
                    {cat.label}
                  </h2>
                  <span className="text-[10px] text-muted-foreground/60">{cat.hint}</span>
                </div>
                <div className="px-2 py-2 space-y-1">
                  {items.map((s) => (
                    <ScenarioCard
                      key={s.id}
                      scenario={s}
                      onInject={() => fireInject(s)}
                      onLive={() => fireLive(s)}
                      injectPending={inject.isPending && lastFired?.id === s.id && lastFired.via === 'inject'}
                      livePending={live.isPending && lastFired?.id === s.id && lastFired.via === 'live'}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </aside>

      {/* ─── Right pane: actual ExecutionView ─────────── */}
      <main className="flex-1 min-w-0 flex">
        <ExecutionView sessionId={scratch.session.id} />
      </main>
    </div>
  );
}

// ─── Scenario card ─────────────────────────────────────

function ScenarioCard({
  scenario,
  onInject,
  onLive,
  injectPending,
  livePending,
}: {
  scenario: Scenario;
  onInject: () => void;
  onLive: () => void;
  injectPending: boolean;
  livePending: boolean;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-card px-2.5 py-2 hover:border-border transition-colors">
      <div className="text-[11.5px] font-medium text-foreground leading-snug">{scenario.title}</div>
      <div className="text-[10.5px] text-muted-foreground/80 mt-0.5 leading-snug">
        {scenario.description}
      </div>
      <div className="flex items-center gap-1 mt-1.5">
        <button
          type="button"
          onClick={onInject}
          disabled={!scenario.inject || injectPending}
          className={cn(
            'flex-1 inline-flex items-center justify-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
            scenario.inject
              ? 'text-primary border border-primary/40 hover:bg-primary/10'
              : 'text-muted-foreground/40 border border-border/40 cursor-not-allowed',
          )}
          title={scenario.inject ? 'Inject synthetic state, no agent call' : 'No inject path for this scenario'}
        >
          {injectPending ? <Loader2 size={9} className="animate-spin" /> : <Beaker size={9} />}
          Inject
        </button>
        <button
          type="button"
          onClick={onLive}
          disabled={!scenario.live || livePending}
          className={cn(
            'flex-1 inline-flex items-center justify-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
            scenario.live
              ? 'text-amber-500 border border-amber-500/40 hover:bg-amber-500/10'
              : 'text-muted-foreground/40 border border-border/40 cursor-not-allowed',
          )}
          title={
            scenario.live
              ? `Live agent dispatch in ${scenario.live.mode} mode (costs tokens)`
              : 'No live path for this scenario'
          }
        >
          {livePending ? <Loader2 size={9} className="animate-spin" /> : <Zap size={9} />}
          Live
        </button>
      </div>
    </div>
  );
}

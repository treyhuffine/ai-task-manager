'use client';

import { useMemo, useState } from 'react';
import { GitBranch, Gauge, Loader2, RefreshCw, Search, Sparkles, Zap, Check, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { workspacesApi } from '@/lib/api/workspaces';
import { ApiError } from '@/lib/api/client';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { LauncherPopoverContent } from './launcher-popover';
import { ModelList, type ModelSelection } from '@/components/settings/model-list';
import { useWorkspaceBranches } from '@/hooks/use-workspaces';
import {
  effortOptionsForModel,
  explicitEffortForModel,
  explicitVariantForModel,
  harnessSupportsEffort,
  providerHarnessKey,
  type ModelOption,
  type ProviderId,
} from '@/lib/agent-options';
import type { EffortLevel } from '@/db/types';
import type { LaunchBase, LaunchMode } from '@/lib/executions/launch-draft';
import { cn } from '@/lib/utils';

const TRIGGER_CLASS =
  'inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-40 disabled:pointer-events-none';

/**
 * Isolation mode as a two-up segmented control rather than a popover.
 *
 * Live used to be its own ⚡ button on the workspace row, then briefly a
 * choice buried one click deep in a popover — which made it *less* discoverable
 * than before, not more. As a visible segment both options are readable at a
 * glance and switching is one click, which is right for something you toggle
 * per-execution rather than configure once.
 *
 * The consequences copy doesn't disappear with the popover: it moves to
 * {@link LiveModeNotice}, rendered inline whenever Live is armed, so the warning
 * is on screen while it applies instead of being dismissed on the way past.
 */
export function ModeControl({
  mode,
  onChange,
  disabled,
}: {
  mode: LaunchMode;
  onChange: (mode: LaunchMode) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Isolation mode"
      className="inline-flex items-center gap-0.5 rounded-md border border-border p-0.5"
    >
      <ModeSegment
        selected={mode === 'worktree'}
        disabled={disabled}
        onSelect={() => onChange('worktree')}
        icon={<GitBranch size={11} />}
        label="Worktree"
        title="Isolated copy on its own branch"
      />
      <ModeSegment
        selected={mode === 'live'}
        disabled={disabled}
        onSelect={() => onChange('live')}
        icon={<Zap size={11} />}
        label="Live"
        title="Runs in your workspace folder, no isolation"
        tone="warning"
      />
    </div>
  );
}

function ModeSegment({
  selected,
  disabled,
  onSelect,
  icon,
  label,
  title,
  tone,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  label: string;
  title: string;
  tone?: 'warning';
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-40',
        selected
          ? tone === 'warning'
            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
            : 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** The Live consequences, shown inline while Live is the armed mode. */
export function LiveModeNotice() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-[10.5px] leading-snug text-amber-700 dark:text-amber-400">
      <Zap size={12} className="mt-px flex-shrink-0" />
      <span>
        The agent edits your actual workspace folder on whatever branch is checked out. No
        isolation, commits land on that branch, and two Live sessions will race on files.
      </span>
    </div>
  );
}

/**
 * The fork point, rendered as a control **and** kept identical to the base
 * chip above it. Picking a branch here is the same event as picking one in
 * browse (it attaches a base chip), so there is exactly one source of truth
 * with two handles on it.
 *
 * When the base came from a PR it's read-only here — a PR head is resolved
 * server-side from `refs/pull/N/head`, so there's no branch name to show
 * that would actually be correct. Clearing is still available.
 */
export function BaseControl({
  workspaceId,
  base,
  workspaceDefault,
  onPickBranch,
  onClear,
  disabled,
}: {
  workspaceId: string | null;
  base: LaunchBase;
  workspaceDefault: string | null;
  onPickBranch: (branch: string) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const { data: branches, isLoading } = useWorkspaceBranches(open ? workspaceId : null);

  const filtered = useMemo(() => {
    const all = branches ?? [];
    if (!filter.trim()) return all.slice(0, 60);
    const q = filter.toLowerCase();
    return all.filter((b) => b.toLowerCase().includes(q)).slice(0, 60);
  }, [branches, filter]);

  const fromPr = base.prNumber != null;
  const label = fromPr
    ? `pr/${base.prNumber}`
    : base.baseBranch ?? workspaceDefault ?? 'default';
  const explicit = fromPr || !!base.baseBranch;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setFilter(''); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={fromPr ? `Forking from pull request #${base.prNumber}` : 'Fork point'}
          className={cn(TRIGGER_CLASS, explicit && 'border-primary/40 text-foreground')}
        >
          <GitBranch size={11} />
          <span className="max-w-[11rem] truncate font-mono">from {label}</span>
        </button>
      </PopoverTrigger>
      <LauncherPopoverContent align="start" className="w-[300px] p-0">
        {fromPr ? (
          <div className="space-y-2 p-3">
            <p className="text-[11px] leading-snug text-muted-foreground">
              Forking from the head of pull request{' '}
              <span className="font-mono text-foreground">#{base.prNumber}</span>. Resolved on the
              server, so it works for forks and PRs you have never checked out.
            </p>
            <button
              type="button"
              onClick={() => { onClear(); setOpen(false); }}
              className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <X size={11} />
              Use the workspace default instead
            </button>
          </div>
        ) : (
          <>
            <div className="relative border-b border-border/70">
              <Search
                size={11}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
              />
              <input
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter branches…"
                className="w-full bg-transparent py-1.5 pl-7 pr-2 text-[11.5px] focus:outline-none"
              />
            </div>
            <div className="max-h-[240px] overflow-y-auto p-1">
              {base.baseBranch && (
                <button
                  type="button"
                  onClick={() => { onClear(); setOpen(false); }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11.5px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                  <X size={11} />
                  Workspace default
                  {workspaceDefault && <span className="font-mono opacity-70">({workspaceDefault})</span>}
                </button>
              )}
              {isLoading && (
                <div className="px-2 py-3 text-center text-[11px] text-muted-foreground/70">Loading…</div>
              )}
              {!isLoading && filtered.length === 0 && (
                <div className="px-2 py-3 text-center text-[11px] italic text-muted-foreground/60">
                  No branches matched.
                </div>
              )}
              {filtered.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => { onPickBranch(b); setOpen(false); }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-mono text-[11.5px] transition-colors',
                    b === base.baseBranch ? 'bg-muted text-foreground' : 'text-foreground/90 hover:bg-muted/60',
                  )}
                >
                  <GitBranch size={11} className="flex-shrink-0 text-muted-foreground/70" />
                  <span className="truncate">{b}</span>
                  {b === base.baseBranch && <Check size={11} className="ml-auto flex-shrink-0 text-primary" />}
                </button>
              ))}
            </div>
          </>
        )}
      </LauncherPopoverContent>
    </Popover>
  );
}

export interface LaunchAgentSelection {
  harness: ProviderId;
  model: string;
  variant: string | null;
  effort: EffortLevel | null;
}

/**
 * Model picker. Simpler than the composer's equivalent: there's no session
 * to take over yet, so every provider is a plain pick with no "this starts
 * a new chat" confirm.
 */
export function ModelControl({
  selection,
  label,
  rememberedEfforts,
  onChange,
  disabled,
}: {
  selection: ModelSelection;
  label: string;
  /** Per-provider effort the user last chose, applied when switching to it. */
  rememberedEfforts?: Record<string, EffortLevel>;
  onChange: (next: LaunchAgentSelection) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const handlePick = (harness: ProviderId, model: ModelOption) => {
    const harnessKey = providerHarnessKey(harness);
    // Resolved here rather than in the caller because this is the only place
    // holding the picked ModelOption — `explicitEffortForModel` needs it to
    // check the remembered value against what this model actually supports,
    // falling back to the model's own default when it doesn't.
    onChange({
      harness,
      model: model.id,
      variant: explicitVariantForModel(model, null),
      effort: harnessSupportsEffort(harnessKey)
        ? explicitEffortForModel(harnessKey, model, rememberedEfforts?.[harness] ?? null)
        : null,
    });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={`Model: ${selection.model}`}
          className={TRIGGER_CLASS}
        >
          <Sparkles size={11} className="text-primary/70" />
          <span className="max-w-[10rem] truncate">{label}</span>
        </button>
      </PopoverTrigger>
      {/* Scrolling + height capping live in LauncherPopoverContent, which also
          renders in-tree so the dialog's scroll lock doesn't eat wheel events. */}
      <LauncherPopoverContent align="end" className="w-80 p-2">
        <ModelList selected={selection} onPick={handlePick} />
      </LauncherPopoverContent>
    </Popover>
  );
}

/**
 * Reasoning effort, paired with the model because it only means anything in
 * the context of one — the available levels come from that model's catalog,
 * and a provider without a reasoning budget has none at all. Renders nothing
 * in that case rather than showing a dead control.
 */
export function EffortControl({
  harness,
  model,
  effort,
  onChange,
  disabled,
}: {
  harness: ProviderId;
  model: ModelOption | null;
  effort: EffortLevel | null;
  onChange: (effort: EffortLevel) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const options = useMemo(() => effortOptionsForModel(harness, model), [harness, model]);
  if (options.length === 0) return null;

  const current = options.find((o) => o.id === effort) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={`Reasoning effort${current ? `: ${current.label}` : ''}`}
          className={TRIGGER_CLASS}
        >
          <Gauge size={11} className="text-primary/70" />
          <span>{current?.shortLabel ?? 'effort'}</span>
        </button>
      </PopoverTrigger>
      <LauncherPopoverContent align="end" className="w-56 p-1">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => {
              onChange(o.id);
              setOpen(false);
            }}
            className={cn(
              'flex w-full items-start gap-2 rounded-md p-2 text-left transition-colors',
              o.id === effort ? 'bg-muted' : 'hover:bg-muted/50',
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="text-[12px] font-medium text-foreground">{o.label}</span>
                {o.id === effort && <Check size={11} className="text-primary" />}
              </span>
              <span className="mt-0.5 block text-[10.5px] leading-snug text-muted-foreground/80">
                {o.hint}
              </span>
            </span>
          </button>
        ))}
      </LauncherPopoverContent>
    </Popover>
  );
}

/**
 * "Is my checkout current" for Live mode, and one click to fix it.
 *
 * Live runs the agent in the workspace directory on whatever branch is checked
 * out, so unlike a worktree there's no fetch-and-fork step to guarantee
 * freshness — you get exactly the code you have. That's the correct contract
 * (it IS your working tree), but it shouldn't be silent: this occupies the slot
 * where the fork-point control sits in worktree mode and answers the same
 * question that control answers there.
 *
 * Refuses on a dirty tree, surfaced as a disabled state with the reason,
 * because merging over uncommitted work to solve a problem the user didn't
 * raise is how you lose someone's afternoon.
 */
export function LiveFreshnessControl({
  workspaceId,
  disabled,
}: {
  workspaceId: string | null;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const key = ['workspace', workspaceId, 'base-status'] as const;

  const status = useQuery({
    queryKey: key,
    queryFn: () => workspacesApi.baseStatus(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });

  const pull = useMutation({
    mutationFn: () => workspacesApi.pullBase(workspaceId!),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (err) => {
      const body = err instanceof ApiError ? (err.body as { message?: string } | null) : null;
      setError(body?.message ?? (err instanceof Error ? err.message : String(err)));
    },
  });

  if (!workspaceId) return null;

  const s = status.data;
  const behind = s?.behind ?? 0;
  const current = !!s && behind === 0;
  const blocked = !!s?.dirty && behind > 0;

  const label = status.isLoading
    ? 'Checking…'
    : !s
      ? 'Base unknown'
      : behind === 0
        ? `Up to date with ${s.base}`
        : `Pull ${s.base} (${behind} behind)`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled || status.isLoading || pull.isPending || current || blocked}
          onClick={() => pull.mutate()}
          className={cn(
            TRIGGER_CLASS,
            behind > 0 && !blocked && 'border-amber-500/40 text-amber-600 dark:text-amber-400',
            blocked && 'border-border',
          )}
        >
          {pull.isPending || status.isLoading ? (
            <Loader2 size={11} className="animate-spin" />
          ) : current ? (
            <Check size={11} className="text-emerald-500" />
          ) : (
            <RefreshCw size={11} />
          )}
          <span className="max-w-[13rem] truncate">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4} className="max-w-[280px]">
        {error
          ? error
          : blocked
            ? `You have uncommitted changes in this folder. Commit or stash them before pulling ${s?.base}.`
            : current
              ? `This checkout matches ${s?.base}. Live sessions will use the latest code.`
              : s?.warning
                ? s.warning
                : `Live runs in this folder as-is. Merge ${s?.base ?? 'the base branch'} in so the agent starts from current code.`}
      </TooltipContent>
    </Tooltip>
  );
}

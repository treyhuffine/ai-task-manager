'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { LauncherPopoverContent } from './launcher-popover';
import { useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import {
  ArrowDownToLine,
  ChevronDown,
  CircleDot,
  Folder,
  GitBranch,
  GitPullRequest,
  Loader2,
  MessageSquare,
  Plug,
  Plus,
  Search,
  SquareCheckBig,
  X,
} from 'lucide-react';
import { useWorkspaces, useCreateExecution } from '@/hooks/use-workspaces';
import { useUserState } from '@/hooks/use-user-state';
import { useAgentModels } from '@/hooks/use-agent-models';
import { useDashboard } from '@/contexts/dashboard-context';
import { sessionsApi } from '@/lib/api/sessions';
import { workspacesApi } from '@/lib/api/workspaces';
import { api, ApiError } from '@/lib/api/client';
import {
  providerIdForHarness,
  defaultModelFor,
  explicitEffortForModel,
  providerHarnessKey,
  type ProviderId,
} from '@/lib/agent-options';
import {
  applyPick,
  canLaunch,
  composePrompt,
  continuationOf,
  readLaunchPrefs,
  removeChip,
  resolveBase,
  writeLaunchPrefs,
  type LaunchChip,
  type LaunchMode,
  type LaunchSourceItem,
  type LaunchSourceKind,
} from '@/lib/executions/launch-draft';
import type { EffortLevel } from '@/db/types';
import type { ExternalAgentImportResult } from '@/lib/import/types';
import { cn } from '@/lib/utils';
import { LaunchBrowse } from './launch-browse';
import {
  BaseControl,
  EffortControl,
  LiveModeNotice,
  ModeControl,
  ModelControl,
  type LaunchAgentSelection,
} from './launch-controls';
import { useLaunchSuggestions } from './use-launch-sources';
import { closeLauncher, useLauncherStore } from './launcher-store';

const CHIP_ICON: Record<LaunchSourceKind, React.ComponentType<{ size?: number; className?: string }>> = {
  pr: GitPullRequest,
  issue: CircleDot,
  branch: GitBranch,
  task: SquareCheckBig,
  note: SquareCheckBig,
  connector: Plug,
  chat: MessageSquare,
  external: ArrowDownToLine,
};

/**
 * The execution launcher. One ➕ replaces what used to be three separate
 * workspace-row buttons (new execution, create-from-git, Live mode), because
 * those were never three different actions — they were one action with three
 * different starting contexts, each of which committed you to a worktree
 * before you had said what you wanted.
 *
 * The invariant that keeps this from rotting into a form you dread: **the
 * prompt is focused on open and everything else is defaulted and skippable.**
 * Type text, press Enter, and you get byte-for-byte what the old ➕ did. Every
 * chip, every control, every source is opt-in on top of that.
 *
 * Work is staged in two phases so abandoning the modal never leaves garbage:
 *
 *   - **Warm** (on pick): fetch a PR/issue body. Network only, discardable.
 *   - **Commit** (on Start): create the execution, then send the message.
 *
 * There's no separate "provision early to hide latency" step because
 * `dispatchExecutionSession` already returns before the worktree exists — the
 * user lands on the SetupCard while git works in the background, exactly as
 * they do today.
 */
export function LaunchModal() {
  const { open, workspaceId: seedWorkspaceId, nonce } = useLauncherStore();
  return open ? <LaunchModalInner key={nonce} seedWorkspaceId={seedWorkspaceId} /> : null;
}

function LaunchModalInner({ seedWorkspaceId }: { seedWorkspaceId: string | null }) {
  const { data: workspaces } = useWorkspaces({ status: 'active' });
  const { data: userState } = useUserState();
  const { setActiveView } = useDashboard();
  const createExecution = useCreateExecution();
  const qc = useQueryClient();

  const [workspaceId, setWorkspaceId] = useState<string | null>(
    seedWorkspaceId ?? workspaces?.[0]?.id ?? null,
  );
  const workspace = workspaces?.find((w) => w.id === workspaceId) ?? null;
  const isGit = !!workspace?.isGit;

  const [text, setText] = useState('');
  const [chips, setChips] = useState<LaunchChip[]>([]);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  // ─── Sticky per-workspace settings ──────────────────────────
  // Read lazily off the workspace so switching the workspace chip swaps in
  // that repo's remembered mode/base/model rather than carrying the last
  // one over. A `staging` base branch following you into a repo that has no
  // such branch is exactly the bug global prefs would cause.
  const [mode, setMode] = useState<LaunchMode>('worktree');
  const [agent, setAgent] = useState<LaunchAgentSelection | null>(null);
  const [efforts, setEfforts] = useState<Record<string, EffortLevel>>({});
  const prefsWorkspaceRef = useRef<string | null>(null);

  const fallbackProvider: ProviderId = providerIdForHarness(userState?.defaultAgentHarness ?? 'claude');
  const fallbackModel = userState?.defaultAgentModel ?? defaultModelFor(fallbackProvider);

  useEffect(() => {
    if (!workspaceId || prefsWorkspaceRef.current === workspaceId) return;
    prefsWorkspaceRef.current = workspaceId;
    const prefs = readLaunchPrefs(workspaceId);
    setMode(prefs.mode);
    setEfforts(prefs.efforts);
    setAgent(
      prefs.harness && prefs.model
        ? {
            harness: prefs.harness as ProviderId,
            model: prefs.model,
            variant: null,
            effort: prefs.efforts[prefs.harness] ?? null,
          }
        : null,
    );
    // A remembered base branch re-attaches as a real base chip, so the chip
    // rail and the footer control never disagree about the fork point.
    setChips((prev) => {
      const withoutBase = prev.filter((c) => c.chipKind !== 'base');
      if (!prefs.baseBranch) return withoutBase;
      return applyPick(withoutBase, {
        kind: 'branch',
        key: prefs.baseBranch,
        title: prefs.baseBranch,
        ref: prefs.baseBranch,
      });
    });
  }, [workspaceId]);

  const selection = useMemo(
    () => ({
      harness: agent?.harness ?? fallbackProvider,
      model: agent?.model ?? fallbackModel,
    }),
    [agent, fallbackProvider, fallbackModel],
  );
  const { models } = useAgentModels(selection.harness);
  const selectedModelOption = useMemo(
    () => models.find((m) => m.id === selection.model) ?? null,
    [models, selection.model],
  );
  const modelLabel = selectedModelOption?.label ?? selection.model;
  // Fall back to what the model itself would pick, so the control reads as the
  // effort that will actually be used rather than an empty placeholder.
  const effort: EffortLevel | null =
    agent?.effort
    ?? (selectedModelOption
      ? explicitEffortForModel(
          providerHarnessKey(selection.harness),
          selectedModelOption,
          efforts[selection.harness] ?? null,
        )
      : null);

  const base = resolveBase(chips);
  const continuation = continuationOf(chips);
  const suggestions = useLaunchSuggestions({ workspaceId, isGit, enabled: !browseOpen });

  // ─── Warm: fold a picked PR/issue's body into its context chip ──
  // Fired on pick, awaited by nobody. If the user launches before it lands
  // the prompt simply carries the title without the description, which is
  // a graceful degradation rather than a stall.
  const warm = useCallback(
    async (item: LaunchSourceItem) => {
      if (!workspaceId || item.number == null) return;
      if (item.kind !== 'pr' && item.kind !== 'issue') return;
      try {
        const detail =
          item.kind === 'pr'
            ? await workspacesApi.getPR(workspaceId, item.number)
            : await workspacesApi.getIssue(workspaceId, item.number);
        const chipIdToPatch = `context:${item.kind}:${item.key}`;
        setChips((prev) =>
          prev.map((c) =>
            c.id === chipIdToPatch && c.context
              ? { ...c, detail: null, context: { ...c.context, body: (detail.body ?? '').trim() } }
              : c,
          ),
        );
      } catch {
        /* the title-only chip is still useful — don't surface a warm failure */
      }
    },
    [workspaceId],
  );

  const handlePick = useCallback(
    (item: LaunchSourceItem) => {
      setChips((prev) => applyPick(prev, item));
      setError(null);
      void warm(item);
      promptRef.current?.focus();
    },
    [warm],
  );

  const handlePickBranch = useCallback((branch: string) => {
    setChips((prev) =>
      applyPick(prev, { kind: 'branch', key: branch, title: branch, ref: branch }),
    );
  }, []);

  const clearBase = useCallback(() => {
    setChips((prev) => prev.filter((c) => c.chipKind !== 'base'));
  }, []);

  const persistPrefs = useCallback(
    (
      overrides: Partial<{
        mode: LaunchMode;
        harness: string;
        model: string;
        efforts: Record<string, EffortLevel>;
      }> = {},
    ) => {
      writeLaunchPrefs(workspaceId, {
        mode: overrides.mode ?? mode,
        baseBranch: resolveBase(chips).baseBranch,
        harness: overrides.harness ?? selection.harness,
        model: overrides.model ?? selection.model,
        efforts: overrides.efforts ?? efforts,
      });
    },
    [workspaceId, mode, chips, selection.harness, selection.model, efforts],
  );

  // Mode and model stick the moment they change, not only on a successful
  // launch. Opening the launcher, flipping to Live, then closing without
  // starting is still a decision worth remembering — and the old
  // persist-on-launch-only behavior silently discarded it.
  const handleModeChange = useCallback(
    (next: LaunchMode) => {
      setMode(next);
      persistPrefs({ mode: next });
    },
    [persistPrefs],
  );

  const handleAgentChange = useCallback(
    (next: LaunchAgentSelection) => {
      setAgent(next);
      // `next.effort` already resolved this provider's remembered value against
      // what the picked model supports (see ModelControl), so record it back.
      const nextEfforts = next.effort
        ? { ...efforts, [next.harness]: next.effort }
        : efforts;
      setEfforts(nextEfforts);
      persistPrefs({ harness: next.harness, model: next.model, efforts: nextEfforts });
    },
    [persistPrefs, efforts],
  );

  const handleEffortChange = useCallback(
    (next: EffortLevel) => {
      const harness = agent?.harness ?? fallbackProvider;
      setAgent((prev) => ({
        harness: prev?.harness ?? fallbackProvider,
        model: prev?.model ?? fallbackModel,
        variant: prev?.variant ?? null,
        effort: next,
      }));
      const nextEfforts = { ...efforts, [harness]: next };
      setEfforts(nextEfforts);
      persistPrefs({ efforts: nextEfforts });
    },
    [persistPrefs, efforts, agent?.harness, fallbackProvider, fallbackModel],
  );

  // ─── Commit ─────────────────────────────────────────────────
  const launch = async () => {
    if (launching) return;
    if (!workspaceId) {
      setError('Pick a workspace first.');
      return;
    }
    if (!canLaunch(text, chips)) return;

    setLaunching(true);
    setError(null);
    const content = composePrompt(text, chips);

    try {
      let targetSessionId: string;

      if (continuation) {
        // Continue an existing chat rather than creating an execution. A
        // provider session that isn't in Flow yet gets adopted first — one
        // key, on demand, which is the single-session half of what the bulk
        // Settings → Imports panel does across every project at once.
        let needsReactivate = continuation.archived;

        if (continuation.sessionId) {
          targetSessionId = continuation.sessionId;
        } else if (continuation.externalKey) {
          const result = await api.post<ExternalAgentImportResult>(
            '/imports/agents',
            { sessionKeys: [continuation.externalKey] },
            { timeoutMs: 10 * 60_000 },
          );
          const landed = result.sessions.find((s) => s.key === continuation.externalKey);
          if (!landed) {
            throw new Error(
              result.failures[0]?.error ?? "That chat couldn't be imported.",
            );
          }
          targetSessionId = landed.chatSessionId;
          needsReactivate = true;
          await Promise.all([
            qc.invalidateQueries({ queryKey: ['imports', 'external-agents'] }),
            qc.invalidateQueries({ queryKey: ['workspaces'] }),
            qc.invalidateQueries({ queryKey: ['sessions', 'rail'] }),
          ]);
        } else {
          throw new Error('That chat is no longer available.');
        }

        // Reactivate BEFORE navigating. `ExecutionView` auto-resumes an
        // archived chat on mount, but that's a race we'd lose: the message
        // POST rejects archived sessions outright, so relying on the view to
        // get there first would fail intermittently.
        if (needsReactivate) {
          await sessionsApi.continueWork(targetSessionId);
        }
      } else {
        const session = await createExecution.mutateAsync({
          workspaceId,
          baseBranch: base.baseBranch,
          prNumber: base.prNumber,
          liveMode: mode === 'live',
          harness: selection.harness,
          model: selection.model,
          modelVariant: agent?.variant ?? null,
          effort,
        });
        targetSessionId = session.id;
      }

      // Navigate first so the user lands on the transcript (and, for a
      // fresh worktree, its SetupCard) while the message POST is in flight.
      persistPrefs();
      setActiveView(targetSessionId);
      closeLauncher();

      if (content.trim().length > 0) {
        await sessionsApi.sendMessage(targetSessionId, content, { eventId: uuidv7() });
      }
    } catch (err) {
      let message: string;
      if (err instanceof ApiError) {
        const body = err.body as { error?: string; message?: string } | null;
        message = body?.message ?? body?.error ?? `Request failed (${err.status})`;
      } else {
        message = err instanceof Error ? err.message : String(err);
      }
      setError(message);
      setLaunching(false);
    }
  };

  const ready = canLaunch(text, chips) && !!workspaceId;

  const handlePromptKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && (e.altKey || e.metaKey)) {
      // ⌥⏎ / ⌘⏎ opens browse. Checked before the plain-Enter branch below.
      e.preventDefault();
      setBrowseOpen(true);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void launch();
      return;
    }
    if (e.key === 'Backspace' && text.length === 0 && chips.length > 0) {
      e.preventDefault();
      setChips((prev) => prev.slice(0, -1));
    }
  };

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && closeLauncher()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        {/* Anchored near the top rather than vertically centered. The panel
            grows downward as browse opens and chips accumulate, so centering
            made it drift upward as it filled — and pushed the footer's popovers
            (which open upward) off the top of the screen.

            Centered with `inset-x-0 mx-auto`, NOT `left-1/2 -translate-x-1/2`,
            and deliberately carrying no animation of its own. A transform here
            (including an animated one) would become the containing block for
            the launcher's `position: fixed` popovers, which re-clips them
            inside the panel's `overflow-hidden`. See `launcher-popover.tsx`. */}
        <DialogPrimitive.Content
          className="fixed inset-x-0 top-[8vh] z-50 mx-auto w-full max-w-2xl px-3"
          onOpenAutoFocus={(e) => {
            // Land in the prompt, not on the first focusable (the workspace
            // chip). This is the whole express lane: open, type, Enter.
            e.preventDefault();
            promptRef.current?.focus();
          }}
          onEscapeKeyDown={(e) => {
            // Escape peels one layer at a time. With browse open it collapses
            // the panel and returns to the prompt; only a second Escape
            // dismisses the modal. This has to live here rather than on the
            // panel's own handler because Radix's dismissable layer binds
            // Escape on the document, out of reach of React's synthetic
            // event propagation.
            if (!browseOpen) return;
            e.preventDefault();
            setBrowseOpen(false);
            promptRef.current?.focus();
          }}
        >
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>Start work</DialogPrimitive.Title>
            <DialogPrimitive.Description>
              Describe what you want, optionally attaching a pull request, issue, branch, task, or
              existing chat.
            </DialogPrimitive.Description>
          </VisuallyHidden.Root>

          <div className="flex max-h-[84vh] animate-in flex-col overflow-hidden rounded-xl border border-border bg-card fade-in-0 shadow-2xl duration-150">
            {/* Header — WHERE the work happens. Workspace, isolation mode and
                fork point are one thought ("this repo, isolated, off main"),
                so they sit together above the prompt. The footer is left for
                WHO does it (model + effort) next to Start. */}
            <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 px-3 py-2">
              <WorkspacePicker
                workspaces={workspaces ?? []}
                workspaceId={workspaceId}
                onChange={setWorkspaceId}
              />
              {!continuation && isGit && (
                <ModeControl mode={mode} onChange={handleModeChange} disabled={launching} />
              )}
              {!continuation && isGit && mode === 'worktree' && (
                <BaseControl
                  workspaceId={workspaceId}
                  base={base}
                  workspaceDefault={workspace?.baseBranch ?? null}
                  onPickBranch={handlePickBranch}
                  onClear={clearBase}
                  disabled={launching}
                />
              )}
              <DialogPrimitive.Close asChild>
                <button
                  className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="Close"
                >
                  <X size={15} />
                </button>
              </DialogPrimitive.Close>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-2">
              <textarea
                ref={promptRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handlePromptKeyDown}
                rows={3}
                placeholder="What are we working on?"
                className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />

              {chips.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {chips.map((chip) => (
                    <Chip
                      key={chip.id}
                      chip={chip}
                      onRemove={() => setChips((prev) => removeChip(prev, chip.id))}
                    />
                  ))}
                </div>
              )}

              {browseOpen ? (
                <LaunchBrowse
                  workspaceId={workspaceId}
                  workspaceCwd={workspace?.cwd ?? null}
                  isGit={isGit}
                  onPick={handlePick}
                  onClose={() => {
                    setBrowseOpen(false);
                    promptRef.current?.focus();
                  }}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                    Start from
                  </span>
                  <button
                    type="button"
                    onClick={() => setBrowseOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-solid hover:bg-muted/50 hover:text-foreground"
                  >
                    <Search size={10} />
                    Browse
                    <kbd className="font-mono text-[9px] opacity-60">⌥⏎</kbd>
                  </button>
                  {suggestions.map((item) => {
                    const Icon = CHIP_ICON[item.kind];
                    return (
                      <button
                        key={`${item.kind}:${item.key}`}
                        type="button"
                        onClick={() => handlePick(item)}
                        title={item.title}
                        className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                      >
                        <Icon size={10} className="flex-shrink-0" />
                        <span className="truncate">
                          {item.number != null ? `#${item.number} ` : ''}
                          {item.title}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {isGit && mode === 'live' && !continuation && <LiveModeNotice />}

              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive">
                  {error}
                </div>
              )}
            </div>

            {/* Footer — controls + Start */}
            <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 border-t border-border bg-muted/25 px-3 py-2">
              {continuation ? (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-[11px] text-foreground">
                  <MessageSquare size={11} className="text-primary/70" />
                  Continuing an existing chat
                </span>
              ) : (
                <>
                  <ModelControl
                    selection={selection}
                    label={modelLabel}
                    rememberedEfforts={efforts}
                    onChange={handleAgentChange}
                    disabled={launching}
                  />
                  <EffortControl
                    harness={selection.harness}
                    model={selectedModelOption}
                    effort={effort}
                    onChange={handleEffortChange}
                    disabled={launching}
                  />
                </>
              )}

              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void launch()}
                  disabled={!ready || launching}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {launching && <Loader2 size={12} className="animate-spin" />}
                  Start
                  <kbd className="font-mono text-[9.5px] opacity-70">⏎</kbd>
                </button>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * One attached chip. The `chipKind` prefix is always visible because the
 * whole point of the typed-chip model is that the user can tell at a glance
 * whether a pick changed the fork point or just added reading material.
 */
function Chip({ chip, onRemove }: { chip: LaunchChip; onRemove: () => void }) {
  const Icon = CHIP_ICON[chip.sourceKind];
  const tone =
    chip.chipKind === 'base'
      ? 'border-primary/30 bg-primary/5'
      : chip.chipKind === 'continue'
        ? 'border-primary/30 bg-primary/5'
        : 'border-border bg-background';

  return (
    <span
      className={cn(
        'inline-flex max-w-[20rem] items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]',
        tone,
      )}
      title={chip.detail ?? chip.label}
    >
      <Icon size={10} className="flex-shrink-0 text-muted-foreground/80" />
      <span className="flex-shrink-0 font-medium text-muted-foreground/80">{chip.chipKind}:</span>
      <span className={cn('truncate text-foreground', chip.chipKind === 'base' && 'font-mono')}>
        {chip.label}
      </span>
      {chip.detail && (
        <span className="flex-shrink-0 truncate text-muted-foreground/60">{chip.detail}</span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${chip.label}`}
        className="ml-0.5 flex-shrink-0 rounded text-muted-foreground/60 transition-colors hover:text-foreground"
      >
        <X size={10} />
      </button>
    </span>
  );
}

/**
 * Workspace is a chip, not a container. Opening from a row prefills it, but
 * a launch can still target a different workspace — which is what lets this
 * same modal serve as a global "start work" entry point.
 */
function WorkspacePicker({
  workspaces,
  workspaceId,
  onChange,
}: {
  workspaces: { id: string; name: string; emoji: string | null }[];
  workspaceId: string | null;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = workspaces.find((w) => w.id === workspaceId);

  // Radix Popover (which portals to the body) rather than an absolutely
  // positioned child. The modal's shell is `overflow-hidden` so it can clip
  // its own scroll regions, and an in-tree dropdown gets clipped by it —
  // the list rendered *inside* the modal instead of floating over it.
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] font-semibold text-foreground transition-colors hover:bg-muted/60"
        >
          {current?.emoji ? (
            <span className="text-[13px] leading-none">{current.emoji}</span>
          ) : (
            <Folder size={12} className="text-muted-foreground/70" />
          )}
          {current?.name ?? 'Pick a workspace'}
          <ChevronDown size={11} className="text-muted-foreground/60" />
        </button>
      </PopoverTrigger>
      <LauncherPopoverContent align="start" className="w-60 p-1">
        {workspaces.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => {
              onChange(w.id);
              setOpen(false);
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] transition-colors',
              w.id === workspaceId ? 'bg-muted text-foreground' : 'text-foreground/90 hover:bg-muted/60',
            )}
          >
            {w.emoji ? (
              <span className="text-[13px] leading-none">{w.emoji}</span>
            ) : (
              <Folder size={11} className="text-muted-foreground/70" />
            )}
            <span className="truncate">{w.name}</span>
          </button>
        ))}
      </LauncherPopoverContent>
    </Popover>
  );
}

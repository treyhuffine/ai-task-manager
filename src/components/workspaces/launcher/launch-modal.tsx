'use client';

import { invalidateWorkspaceViews } from '@/lib/query/work-view-invalidation';
import { WorkspacePicker } from '@/components/workspaces/workspace-picker';

import { useHomeStorageScope } from '@/components/home/home-context';
import { useExecutionRuntimeScope } from '@/components/home/execution-runtime-context';
import { LaunchAudience } from './launch-audience';
import { useDefaultSelection } from '@/hooks/use-default-selection';
import { useViewportTier } from '@/hooks/use-viewport-tier';
import { useVisualViewportBottom } from '@/hooks/use-visual-viewport-bottom';

import { AttachButton } from '@/components/chat/editor/attach-button';
import { ChatDropZone } from '@/components/chat/editor/chat-drop-zone';
import {
	ChatInputEditor,
	type ChatInputEditorHandle,
} from '@/components/chat/editor/chat-input-editor';
import { useWorkNavigation } from '@/contexts/work-context';
import type { EffortLevel } from '@/db/types';
import { useRunsOnSeveralDevices } from '@/hooks/use-devices';
import { useHarnessModels } from '@/hooks/use-harness-models';
import { useUserState } from '@/hooks/use-user-state';
import { useMentionAgents, useRunOn, useSetDefaultDevice, useWorkspacePRs, useWorkspaces } from '@/hooks/use-workspaces';
import { useChatCapabilities } from '@/components/chat-ui/chat-capabilities';
import { useLoadReferenceTree, useReferenceFolders } from '@/hooks/use-reference-folders';
import type { ReferenceFolderMentionItem } from '@/components/chat/editor/mention-menu/types';
import { apiErrorText } from '@/lib/api/client';
import { sessionsApi } from '@/lib/api/sessions';
import { tasksApi } from '@/lib/api/tasks';
import { workspacesApi } from '@/lib/api/workspaces';
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
import {
	readProviderEffort,
	readProviderEfforts,
	writeProviderEffort,
} from '@/lib/executions/provider-effort';
import { startExecution } from '@/lib/executions/start-execution';
import { readProviderSpeed, writeProviderSpeed } from '@/lib/executions/provider-speed';
import { serviceTierForModel } from '@/lib/harness/service-tiers';
import {
	defaultModelFor,
	explicitEffortForModel,
	type ProviderId,
} from '@/lib/harness/options';
import { DEFAULT_HARNESS } from '@/lib/harness/registry';
import { trpcClient } from '@/lib/trpc/client';
import { rpcOptions } from '@/lib/trpc/request-options';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import {
	ArrowDownToLine,
	CircleDot,
	GitBranch,
	GitPullRequest,
	Loader2,
	MessageSquare,
	Plug,
	Search,
	SquareCheckBig,
	X,
} from 'lucide-react';
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { uuidv7 } from 'uuidv7';
import { LaunchBrowse } from './launch-browse';
import {
	BaseControl,
	LiveFreshnessControl,
	LiveModeNotice,
	ModeControl,
	ModelControl,
	RunOnControl,
	type LaunchHarnessSelection,
} from './launch-controls';
import { closeLauncher, useLauncherStore, type LauncherSeed } from './launcher-store';
import { useLaunchSuggestions } from './use-launch-sources';
import { Tip } from '@/components/ui/tip';

const CHIP_ICON: Record<LaunchSourceKind, React.ComponentType<{ size?: number; className?: string }>> = {
  pr: GitPullRequest,
  issue: CircleDot,
  branch: GitBranch,
  task: SquareCheckBig,
  note: SquareCheckBig,
  integration: Plug,
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
  const { open, workspaceId: seedWorkspaceId, seed, pickAgent, nonce } = useLauncherStore();
  return open ? (
    <LaunchModalInner key={nonce} seedWorkspaceId={seedWorkspaceId} seed={seed} pickAgent={pickAgent} />
  ) : null;
}

function LaunchModalInner({
  seedWorkspaceId,
  seed,
  pickAgent,
}: {
  seedWorkspaceId: string | null;
  seed: LauncherSeed | null;
  /** Opened with no agent picked (the rail's Create): don't fill one in. */
  pickAgent: boolean;
}) {
  const { data: workspaces } = useWorkspaces({ status: 'active' });
  const { data: userState } = useUserState();
  const { openExecution } = useWorkNavigation();
  const qc = useQueryClient();

  const [workspaceId, setWorkspaceId] = useState<string | null>(
    pickAgent ? null : seedWorkspaceId ?? workspaces?.[0]?.id ?? null,
  );
  // The agent picker is controlled so a launch with no agent can open it
  // instead of failing: the prompt is already written, only "where" is left.
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const workspace = workspaces?.find((w) => w.id === workspaceId) ?? null;
  const isGit = !!workspace?.isGit;
  const { personalControls } = useExecutionRuntimeScope();
  const storageScope = useHomeStorageScope();
  const defaultSelection = useDefaultSelection();

  // Below desktop (a phone's + sheet, a tablet) the launcher takes touch
  // rules, the same ones the chat composer follows there: Enter adds a line
  // and Start sends, no keys are hinted at, and the panel stays above the
  // on-screen keyboard so Start is always in reach.
  const tier = useViewportTier();
  const touch = tier !== null && tier !== 'desktop';
  const visibleBottom = useVisualViewportBottom();

  // Where it runs (P3.1): the agent's default, unless picked for this one
  // execution. A pick never sticks: the next launch starts from the default
  // again, and saving a new default is its own action.
  const severalDevices = useRunsOnSeveralDevices();
  const { data: runOn } = useRunOn(workspaceId);
  const setDefaultDevice = useSetDefaultDevice(workspaceId);
  const [runOnPick, setRunOnPick] = useState<{ workspaceId: string; deviceId: string } | null>(null);
  const runOnTarget =
    (runOnPick && runOnPick.workspaceId === workspaceId ? runOnPick.deviceId : null) ?? runOn?.defaultId ?? null;
  const runOnChoice = runOn?.choices.find((c) => c.deviceId === runOnTarget) ?? null;
  // A device that can't take the work blocks the start, with why. Never
  // another device in its place.
  const runOnProblem = runOnChoice && !runOnChoice.ready ? runOnChoice.problem : null;

  // The agent's reference folders (and the global ones) in the `@` picker, so
  // a folder can be tagged before the execution exists. Their paths are this
  // machine's, so they're offered only when the work will run here.
  const { data: referenceFolders } = useReferenceFolders(workspaceId);
  const runsHere = !runOnChoice || runOnChoice.isHome;
  const mentionReferenceFolders = useMemo<ReferenceFolderMentionItem[]>(
    () =>
      runsHere
        ? (referenceFolders ?? []).map((r) => ({
            kind: 'reference',
            id: r.id,
            alias: r.alias,
            absolutePath: r.absolutePath,
            exists: r.exists,
            browsable: true,
          }))
        : [],
    [referenceFolders, runsHere],
  );
  // Other agents to bring in, as in any chat's composer. A team's chats
  // can't reach each other, so its launcher offers none.
  const mentionAgents = useMentionAgents(useChatCapabilities().coordination !== false);
  const loadReferenceTree = useLoadReferenceTree();

  // The editor owns its own document; we only mirror "is there anything to
  // send" for the Start button. Pulling the text out happens once, at launch.
  const [hasContent, setHasContent] = useState(false);
  const [pendingUploads, setPendingUploads] = useState(false);
  // "Start with agent" seeds a task context chip (folded into the prompt) and
  // records ownership of the task via seed.taskId on launch.
  const [chips, setChips] = useState<LaunchChip[]>(() =>
    seed?.taskId
      ? [
          {
            id: `context:task:${seed.taskId}`,
            chipKind: 'context',
            sourceKind: 'task',
            label: seed.contextTitle ?? 'Task',
            context: { heading: `Task: ${seed.contextTitle ?? ''}`.trim(), body: (seed.contextBody ?? '').trim() },
          },
        ]
      : [],
  );
  const [browseOpen, setBrowseOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<ChatInputEditorHandle>(null);

  // ─── Sticky per-workspace settings ──────────────────────────
  // Read lazily off the workspace so switching the workspace chip swaps in
  // that repo's remembered mode/base/model rather than carrying the last
  // one over. A `staging` base branch following you into a repo that has no
  // such branch is exactly the bug global prefs would cause.
  const [mode, setMode] = useState<LaunchMode>('worktree');
  const [harnessPick, setHarnessPick] = useState<LaunchHarnessSelection | null>(null);
  const [efforts, setEfforts] = useState<Record<string, EffortLevel>>({});
  const prefsWorkspaceRef = useRef<string | null>(null);

  const fallbackProvider: ProviderId = defaultSelection?.harness ?? userState?.defaultHarness ?? DEFAULT_HARNESS;
  const fallbackModel = defaultSelection?.model ?? userState?.defaultModel ?? defaultModelFor(fallbackProvider);

  useEffect(() => {
    if (!workspaceId || prefsWorkspaceRef.current === workspaceId) return;
    prefsWorkspaceRef.current = workspaceId;
    const prefs = readLaunchPrefs(workspaceId, storageScope);
    setMode(prefs.mode);
    setEfforts(readProviderEfforts(storageScope));
    setHarnessPick(
      prefs.harness && prefs.model
        ? {
            harness: prefs.harness as ProviderId,
            model: prefs.model,
            variant: null,
            effort: readProviderEffort(prefs.harness, storageScope),
            serviceTier: readProviderSpeed(prefs.harness, storageScope),
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
  }, [workspaceId, storageScope]);

  const selection = useMemo(
    () => ({
      harness: harnessPick?.harness ?? fallbackProvider,
      model: harnessPick?.model ?? fallbackModel,
    }),
    [harnessPick, fallbackProvider, fallbackModel],
  );
  const { models } = useHarnessModels(selection.harness);
  const runtimeProblem = !personalControls && workspaceId && !workspace ? 'Opening the selected agent…' : !personalControls && (!selectedModelAvailable(models, selection.model) || (!harnessPick && !defaultSelection)) ? 'Choose a model available to the team.' : null;
  const selectedModelOption = useMemo(
    () => models.find((m) => m.id === selection.model) ?? null,
    [models, selection.model],
  );
  const modelLabel = selectedModelOption?.label ?? selection.model;
  const serviceTier = serviceTierForModel(selectedModelOption, harnessPick?.serviceTier
    ?? (selection.harness === userState?.defaultHarness && selection.model === userState.defaultModel ? userState.defaultServiceTier : null));
  // Fall back to what the model itself would pick, so the control reads as the
  // effort that will actually be used rather than an empty placeholder.
  const effort: EffortLevel | null =
    harnessPick?.effort
    ?? (selectedModelOption
      ? explicitEffortForModel(
          selection.harness,
          selectedModelOption,
          efforts[selection.harness] ?? null,
        )
      : null);

  // The launcher already fetches this workspace's open PRs for browse; the
  // editor's `#` menu takes the same shape, so it costs nothing extra.
  const { data: workspacePrs } = useWorkspacePRs(isGit ? workspaceId : null);
  const prMentions = useMemo(() => workspacePrs ?? [], [workspacePrs]);

  const base = resolveBase(chips);
  const continuation = continuationOf(chips);
  // A base chip is meaningless in Live mode, and showing one the launch will
  // ignore is worse than showing nothing. Hidden rather than deleted, so
  // toggling back to Worktree restores the fork point you picked.
  const visibleChips = useMemo(
    () => (mode === 'live' ? chips.filter((c) => c.chipKind !== 'base') : chips),
    [chips, mode],
  );
  const suggestions = useLaunchSuggestions({ workspaceId, isGit, enabled: !browseOpen });

  // ─── Warm: fold a picked PR/issue's body into its context chip ──
  // Fired on pick, awaited by nobody. If the user launches before it lands
  // the prompt simply carries the title without the description, which is
  // a graceful degradation rather than a stall.
  const warm = useCallback(
    async (item: LaunchSourceItem) => {
      // Tasks: `/api/tasks` sends a bounded excerpt, not the whole body, so
      // the chip built from list data would carry a prompt truncated at 300
      // characters. Fetch the full record the same way a PR or issue does.
      // Handled before the `item.number` guard below — tasks have no number.
      if (item.kind === 'task') {
        try {
          const full = await tasksApi.get(item.key);
          const chipIdToPatch = `context:task:${item.key}`;
          const body = (full.body ?? full.description ?? '').trim();
          setChips((prev) =>
            prev.map((c) =>
              c.id === chipIdToPatch && c.context
                ? { ...c, detail: body ? null : c.detail, context: { ...c.context, body } }
                : c,
            ),
          );
        } catch {
          /* the excerpt already in the chip is still a usable prompt */
        }
        return;
      }

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
      // Back to the prompt for the next keystroke. Not on touch, where that
      // raises the keyboard over the list you're still picking from.
      if (!touch) editorRef.current?.focus({ end: true });
    },
    [warm, touch],
  );

  const openBrowse = () => {
    // On touch, the list opens with the keyboard down so all of it shows.
    if (touch && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setBrowseOpen(true);
  };

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
      }> = {},
    ) => {
      writeLaunchPrefs(workspaceId, {
        mode: overrides.mode ?? mode,
        baseBranch: resolveBase(chips).baseBranch,
        harness: overrides.harness ?? selection.harness,
        model: overrides.model ?? selection.model,
      }, storageScope);
    },
    [workspaceId, mode, chips, selection.harness, selection.model, storageScope],
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

  const handleHarnessChange = useCallback(
    (next: LaunchHarnessSelection) => {
      setHarnessPick(next);
      // `next.effort` already resolved this provider's remembered value against
      // what the picked model supports (see ModelControl), so record it back to
      // the shared store the composer also reads.
      writeProviderEffort(next.harness, next.effort, storageScope);
      if (next.serviceTier) writeProviderSpeed(next.harness, next.serviceTier, storageScope);
      setEfforts(readProviderEfforts(storageScope));
      persistPrefs({ harness: next.harness, model: next.model });
    },
    [persistPrefs, storageScope],
  );

  const handleEffortChange = useCallback(
    (next: EffortLevel) => {
      const harness = harnessPick?.harness ?? fallbackProvider;
      setHarnessPick((prev) => ({
        harness: prev?.harness ?? fallbackProvider,
        model: prev?.model ?? fallbackModel,
        variant: prev?.variant ?? null,
        effort: next,
        serviceTier: prev?.serviceTier ?? serviceTier,
      }));
      writeProviderEffort(harness, next, storageScope);
      setEfforts(readProviderEfforts(storageScope));
    },
    [harnessPick?.harness, fallbackProvider, fallbackModel, serviceTier, storageScope],
  );

  /**
   * Empty the composer once its text has actually been sent.
   *
   * `ChatInputEditor` persists what you type to localStorage under
   * `draftKey` so a mis-click doesn't lose it. Nothing was clearing that on
   * launch, so starting a chat left the draft behind and the next open of the
   * launcher came back pre-filled with a prompt already running somewhere.
   *
   * Clearing is enough to delete the stored copy too: an empty hydrated editor
   * makes `draftStorageAction` return 'remove', and removes are immediate
   * rather than debounced, so it lands before `closeLauncher` unmounts us.
   *
   * Deliberately conditional. An "Open only" launch never sends the text, and
   * silently deleting words the user typed but didn't send would be the worse
   * bug of the two. That draft is still theirs, still keyed to this workspace,
   * and still waiting the next time they open the launcher here.
   */
  const clearComposerIfSent = (sent: boolean) => {
    if (sent) editorRef.current?.clear();
  };

  // ─── Commit ─────────────────────────────────────────────────
  const launch = async ({ send = true }: { send?: boolean } = {}) => {
    if (runtimeProblem) { setError(runtimeProblem); return; }
    if (launching) return;
    if (!workspaceId) {
      // Nothing to fix but where it runs. Ask that, in place, and leave the
      // prompt as it is: picking returns focus to it for Enter.
      setError(null);
      setAgentPickerOpen(true);
      return;
    }
    // The disabled Start button covers clicks, but Enter submits from inside
    // the editor. Check the editor synchronously too so a keypress that races
    // an upload never sends the text while silently dropping its pending file.
    if (send && editorRef.current?.hasPendingUploads()) return;
    // Opening without a prompt is a legitimate destination — you often want
    // the worktree, file tree and terminal before you know what to ask for.
    // Only the send path needs something to actually say.
    // One read of the editor: plain text plus any file chips resolved into
    // real Attachment records. Both travel with the first message.
    const output = editorRef.current?.getMarkerOutput() ?? { text: '', attachments: [] };
    if (send && !canLaunch(output.text, chips)) return;

    setLaunching(true);
    setError(null);
    const content = composePrompt(output.text, chips);

    try {
      let targetSessionId: string;

      if (continuation) {
        // Continue an existing chat rather than creating an execution. A
        // provider session that isn't in Ri yet gets adopted first — one
        // key, on demand, which is the single-session half of what the bulk
        // Settings → Imports panel does across every project at once.
        let needsReactivate = continuation.archived;

        if (continuation.sessionId) {
          targetSessionId = continuation.sessionId;
        } else if (continuation.externalKey) {
          const result = await trpcClient.imports.agentsPost.mutate({body: { sessionKeys: [continuation.externalKey] }}, rpcOptions({ timeoutMs: 10 * 60_000 }));
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
            invalidateWorkspaceViews(qc),
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
        // Live has no fork point — the agent runs in the checkout as it
        // stands. Sending a base anyway stamped `prNumber` on a session that
        // never branched from it, which then read back as "Branched main from
        // PR #90". The controls already hide in Live; this makes the payload
        // agree with them.
        const live = mode === 'live';
        // Normally the server names an execution from its first message. An
        // "Open only" launch never sends one, so without help it lands in the
        // rail as "Untitled" forever — and the branch inherits the same
        // namelessness (`<slug>/session-019fab0b`). Fall back to whatever
        // context was attached, which is the thing the user actually picked.
        const seedLabel = send ? null : (chips.find((c) => c.chipKind === 'context')?.label ?? null);

        // Leave before the work finishes. Every decision this modal exists to
        // collect has been made by now, so holding it open through the create
        // is pure waiting. `startExecution` hands back the session id up front
        // and finishes underneath the view we're about to open.
        const { sessionId } = startExecution(qc, {
          workspaceId,
          label: seedLabel,
          baseBranch: live ? null : base.baseBranch,
          prNumber: live ? null : base.prNumber,
          liveMode: live,
          harness: selection.harness,
          model: selection.model,
          modelVariant: harnessPick?.variant ?? null,
          effort,
          serviceTier,
          message: send ? { content, attachments: output.attachments } : null,
          taskId: seed?.taskId ?? null,
          deviceId: runOnTarget,
        });
        persistPrefs();
        clearComposerIfSent(send);
        openExecution(sessionId);
        closeLauncher('launched');
        return;
      }

      // Continuations navigate here instead: the session already exists (it
      // was imported and reactivated above), so there was never anything to
      // wait on beyond that.
      persistPrefs();
      clearComposerIfSent(send);
      openExecution(targetSessionId);
      closeLauncher('launched');

      if (send && content.trim().length > 0) {
        // Toast rather than `setError` — this fires after `closeLauncher`, so
        // the inline error row it would have rendered no longer exists and the
        // failure would go out silently.
        sessionsApi
          .sendMessage(targetSessionId, content, {
            eventId: uuidv7(),
            attachments: output.attachments,
          })
          .catch((err) => {
            toast.error("Couldn't send that message", { description: apiErrorText(err) });
          });
      }
    } catch (err) {
      setError(apiErrorText(err));
      setLaunching(false);
    }
  };

  // `hasContent` mirrors text or attachment chips; context chips alone are
  // also launchable.
  // Pending uploads block Start so a chip can't be sent half-resolved. No
  // agent yet doesn't: Start asks for one (see `launch`).
  const ready =
    (hasContent || chips.some((c) => c.chipKind === 'context'))
    && !pendingUploads
    && !runOnProblem
    && !runtimeProblem;

  // The editor owns Enter (submit), Shift+Enter (newline) and
  // Backspace-on-empty now. Only ⌥⏎ is ours, and it's caught in the capture
  // phase so it lands before Tiptap sees it. ⌘⏎ is deliberately NOT bound
  // here — the editor treats it as "submit regardless", and stealing it for
  // browse would break the hardware-keyboard escape hatch chat users rely on.
  const handleEditorKeyDownCapture = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.altKey && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      setBrowseOpen(true);
    }
  };

  const attachFile = (file: File) => {
    setError(null);
    const upload = editorRef.current?.uploadFile(file);
    if (!upload) return;
    void upload.catch((err) => setError(apiErrorText(err)));
  };

  return (
    <>
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
            editorRef.current?.focus({ end: true });
          }}
          onEscapeKeyDown={(e) => {
            // Escape backs out of whatever you're *in*, which is not the same
            // as "whatever is open". Browse stays open after a pick so you can
            // grab several things, so keying off `browseOpen` alone meant that
            // once you'd used it, every Escape from then on hit an invisible
            // extra step before the modal would close — which reads as Escape
            // being broken. Focus is the honest signal: inside the search
            // panel, Escape leaves the panel; anywhere else (typically the
            // prompt, where `handlePick` returns you), it closes the modal.
            //
            // Lives here rather than on the panel because Radix's dismissable
            // layer binds Escape on the document, out of reach of React's
            // synthetic event propagation.
            const inBrowse = document.activeElement?.closest('[data-launcher-browse]');
            if (!browseOpen || !inBrowse) return;
            e.preventDefault();
            setBrowseOpen(false);
            editorRef.current?.focus({ end: true });
          }}
        >
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>New chat</DialogPrimitive.Title>
            <DialogPrimitive.Description>
              Describe what you want, optionally attaching a pull request, issue, branch, task, or
              existing chat.
            </DialogPrimitive.Description>
          </VisuallyHidden.Root>

          <ChatDropZone
            className="flex max-h-[84vh] animate-in flex-col overflow-hidden rounded-xl border border-border bg-card fade-in-0 shadow-2xl duration-150"
            // The panel sits 8vh down. Its bottom stops 0.75rem above the
            // keyboard's top edge, so the footer never slides under it.
            style={touch && visibleBottom ? { maxHeight: `min(84vh, calc(${visibleBottom}px - 8vh - 0.75rem))` } : undefined}
            disabled={launching}
            onFiles={(files) => {
              for (const file of files) attachFile(file);
              editorRef.current?.focus({ end: true });
            }}
          >
            <LaunchAudience />
            {/* Header — WHERE the work happens. Workspace, isolation mode and
                fork point are one thought ("this repo, isolated, off main"),
                so they sit together above the prompt. The footer is left for
                WHO does it (model + effort) next to Start. */}
            <div className="flex flex-shrink-0 items-start gap-1.5 px-3 py-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                <WorkspacePicker
                  workspaces={workspaces ?? []}
                  workspaceId={workspaceId}
                  open={agentPickerOpen}
                  onOpenChange={setAgentPickerOpen}
                  onChange={(id) => {
                    setWorkspaceId(id);
                    setError(null);
                    editorRef.current?.focus({ end: true });
                  }}
                />
                {!continuation && severalDevices && runOn && workspaceId && (
                  <RunOnControl
                    agent={{ id: workspaceId, name: workspace?.name ?? 'This agent' }}
                    runOn={runOn}
                    value={runOnTarget}
                    onChange={(deviceId) => setRunOnPick({ workspaceId, deviceId })}
                    onMakeDefault={(deviceId) => setDefaultDevice.mutate(deviceId, { onSuccess: () => setRunOnPick(null) })}
                    savingDefault={setDefaultDevice.isPending}
                    disabled={launching}
                  />
                )}
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
                {/* Live has no fork point to pick, so the same slot answers the
                    same question a different way: is the code you're about to
                    work in current, and pull it if not. */}
                {!continuation && isGit && mode === 'live' && (
                  <LiveFreshnessControl workspaceId={workspaceId} disabled={launching} />
                )}
              </div>
              <DialogPrimitive.Close asChild>
                <button
                  className="flex-shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground pointer-coarse:-m-1 pointer-coarse:p-2"
                  aria-label="Close"
                >
                  <X size={15} />
                </button>
              </DialogPrimitive.Close>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-2">
              {/* The SAME editor the chat composer uses. Brings auto-grow
                  (20px → 200px then scrolls), image paste/drop as attachments,
                  long-paste-becomes-a-file, and `#` PR mentions for free.
                  File `@`-mentions and slash commands are deliberately absent:
                  both are sourced from a worktree/harness that doesn't exist
                  until this modal creates one. Reference folders aren't: they
                  belong to the agent, so `@alias` finds them here too. Nor
                  are agents, which need no worktree. */}
              <div
                onKeyDownCapture={handleEditorKeyDownCapture}
                className="rounded-lg border border-border bg-background px-3 py-2.5 focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/30"
              >
                <ChatInputEditor
                  ref={editorRef}
                  placeholder="What are we working on?"
                  disabled={launching}
                  prs={prMentions}
                  mentionReferenceFolders={mentionReferenceFolders}
                  loadReferenceTree={loadReferenceTree}
                  mentionAgents={mentionAgents}
                  // Opened with no agent, the draft is the launcher's own and
                  // stays put while an agent is picked. Keyed to the agent, a
                  // pick would swap in that agent's draft over what you typed.
                  draftKey={pickAgent ? 'launcher:new' : workspaceId ? `launcher:${workspaceId}` : undefined}
                  onContentChange={setHasContent}
                  onPendingUploadsChange={setPendingUploads}
                  submitOnEnter={!touch}
                  onSubmit={() => void launch()}
                  onBackspaceOnEmpty={() => setChips((prev) => prev.slice(0, -1))}
                  onUploadError={(err: Error) => setError(err.message)}
                />
              </div>

              {visibleChips.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {visibleChips.map((chip) => (
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
                  touch={touch}
                  onPick={handlePick}
                  onClose={() => {
                    setBrowseOpen(false);
                    if (!touch) editorRef.current?.focus({ end: true });
                  }}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                    Start from
                  </span>
                  <button
                    type="button"
                    onClick={openBrowse}
                    className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-solid hover:bg-muted/50 hover:text-foreground"
                  >
                    <Search size={10} />
                    Browse
                    {!touch && <kbd className="font-mono text-[9px] opacity-60">⌥⏎</kbd>}
                  </button>
                  {suggestions.map((item) => {
                    const Icon = CHIP_ICON[item.kind];
                    return (
                      <Tip key={`${item.kind}:${item.key}`} label={item.title} onlyWhenTextHidden>
                        <button
                          type="button"
                          onClick={() => handlePick(item)}
                          className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                        >
                          <Icon size={10} className="flex-shrink-0" />
                          <span className="truncate">
                            {item.number != null ? `#${item.number} ` : ''}
                            {item.title}
                          </span>
                        </button>
                      </Tip>
                    );
                  })}
                </div>
              )}

              {isGit && mode === 'live' && !continuation && <LiveModeNotice />}

              {!continuation && runtimeProblem && <p role="status" className="px-4 py-2 text-[12px] text-muted-foreground">{runtimeProblem}</p>}
              {!continuation && runOnProblem && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                  {runOnProblem}
                </div>
              )}

              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive">
                  {error}
                </div>
              )}
            </div>

            {/* Footer — controls + Start */}
            <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 border-t border-border bg-muted/25 px-3 py-2">
              <AttachButton
                onPick={attachFile}
                disabled={launching}
                title="Attach file"
                className="-ml-1"
              />
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
                    variant={harnessPick?.variant ?? null}
                    effort={effort}
                    serviceTier={serviceTier}
                    onEffortChange={handleEffortChange}
                    rememberedEfforts={efforts}
                    onChange={handleHarnessChange}
                    disabled={launching}
                  />
                </>
              )}

              <div className="ml-auto flex items-center gap-1.5">
                {/* Create the session and go there WITHOUT sending anything —
                    for when you want the checkout, file tree and terminal in
                    front of you before you've decided what to ask. Enabled
                    with an empty prompt, which is the whole point. */}
                <Tip label="Create the session and open it without sending a message">
                  <button
                    type="button"
                    onClick={() => void launch({ send: false })}
                    disabled={launching || !!runOnProblem || !!runtimeProblem}
                    className="rounded-md px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-40 pointer-coarse:py-2 pointer-coarse:text-[13px]"
                  >
                    Open only
                  </button>
                </Tip>
                <button
                  type="button"
                  onClick={() => void launch()}
                  disabled={!ready || launching}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40 pointer-coarse:px-4 pointer-coarse:py-2 pointer-coarse:text-[13px]"
                >
                  {launching && <Loader2 size={12} className="animate-spin" />}
                  Start
                  {!touch && <kbd className="font-mono text-[9.5px] opacity-70">⏎</kbd>}
                </button>
              </div>
            </div>
          </ChatDropZone>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
    </>
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
    <Tip label={chip.detail ? `${chip.label} · ${chip.detail}` : chip.label} onlyWhenTextHidden>
      <span
        className={cn(
          'inline-flex max-w-[20rem] items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]',
          tone,
        )}
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
    </Tip>
  );
}

/**
 * Workspace is a chip, not a container. Opening from a row prefills it, but
 * a launch can still target a different workspace — which is what lets this
 * same modal serve as a global "start work" entry point.
 *
 * Opened with no agent (the rail's Create), the chip asks for one and a launch
 * opens this list. It filters as you type and takes arrows and Enter, so the
 * whole flow stays on the keyboard: write, Enter, type a few letters, Enter,
 * Enter.
 */

function selectedModelAvailable(models: readonly { id: string; availability?: string }[], id: string) { return models.some(model => model.id === id && model.availability !== 'unavailable'); }

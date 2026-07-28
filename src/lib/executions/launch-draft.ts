/**
 * Pure model behind the execution launcher (the ➕ modal on a workspace row).
 *
 * The launcher's whole trick is that a picked *source* (a PR, an issue, a
 * branch, a task, an existing chat) is not one decision. It fans out into
 * typed **chips**, and each chip kind lands somewhere different:
 *
 *   - `base`     → changes where the worktree forks from. Infrastructure.
 *                  At most one, and picking a new one replaces the old.
 *   - `context`  → material appended to the first message. Any number.
 *   - `continue` → don't create anything, send into an existing chat.
 *                  Exclusive with `base` (you can't re-fork a live chat).
 *
 * Selecting PR #402 therefore yields TWO chips (fork from its head, and
 * quote its body), each independently droppable. That's the difference
 * between a launcher the user can steer and one that guesses.
 *
 * Everything here is sync + pure so the modal's behavior is testable
 * without React, a DB, or `gh`. The only impure corner is the prefs
 * read/write, which is localStorage-guarded for SSR.
 */

import type { ExternalAgentSource } from '@/lib/import/types';

export type LaunchSourceKind =
  | 'pr'
  | 'issue'
  | 'branch'
  | 'task'
  | 'note'
  /** A task read live from a connected provider (Todoist, Linear). */
  | 'connector'
  | 'chat'
  | 'external';

export type LaunchChipKind = 'base' | 'context' | 'continue';

/** Worktree isolation vs. running in the workspace folder itself. */
export type LaunchMode = 'worktree' | 'live';

/** One row in the browse list, normalized across every source. */
export interface LaunchSourceItem {
  kind: LaunchSourceKind;
  /** Unique within `kind`. Combined with kind to form chip ids. */
  key: string;
  title: string;
  subtitle?: string | null;
  /** Long-form material folded into a context chip (PR/issue body, task notes). */
  body?: string | null;
  /** PR / issue number, when the source has one. */
  number?: number | null;
  /** Git ref a base chip should fork from (branch name). */
  ref?: string | null;
  /** Flow chat to continue into. */
  sessionId?: string | null;
  /**
   * Chat is archived, so continuing it has to reactivate it first. The
   * messages endpoint hard-rejects archived sessions, and chat search spans
   * archived history by design, so this is the common case rather than the
   * edge one.
   */
  archived?: boolean | null;
  /** Provider session not yet in Flow — imported on demand at launch. */
  externalKey?: string | null;
  externalSource?: ExternalAgentSource | null;
  /** Display name of the connector a `connector` item came from ("Todoist"). */
  providerLabel?: string | null;
  /** Toolkit id of that connector ("todoist") — drives its brand mark. */
  toolkitId?: string | null;
  /** ISO due date, from any source. Drives ordering and the due badge. */
  due?: string | null;
}

/** Where the new worktree forks from. `prNumber` wins over `baseBranch`. */
export interface LaunchBase {
  baseBranch: string | null;
  prNumber: number | null;
}

export interface LaunchContinuation {
  /** An existing Flow chat. Null when this is a not-yet-imported provider session. */
  sessionId: string | null;
  /** Import key for a provider session that has to be adopted first. */
  externalKey: string | null;
  externalSource: ExternalAgentSource | null;
  /** Needs `continueWork` before a message can be sent. */
  archived: boolean;
}

export interface LaunchChip {
  /** `${chipKind}:${sourceKind}:${key}` — stable, so re-picking is a no-op. */
  id: string;
  chipKind: LaunchChipKind;
  sourceKind: LaunchSourceKind;
  label: string;
  detail?: string | null;
  base?: LaunchBase;
  context?: { heading: string; body: string };
  continueFrom?: LaunchContinuation;
}

function chipId(chipKind: LaunchChipKind, item: LaunchSourceItem): string {
  return `${chipKind}:${item.kind}:${item.key}`;
}

function contextHeadingPrefix(item: LaunchSourceItem): string {
  if (item.kind === 'note') return 'Note';
  if (item.kind === 'connector') {
    return item.providerLabel ? `${item.providerLabel} task` : 'External task';
  }
  return 'Task';
}

/**
 * Fan one picked source out into its chips.
 *
 * The interesting cases:
 *   - A **PR** is both a place to fork from and a thing to read, so it
 *     produces a base chip AND a context chip.
 *   - An **issue** has no head ref, so it's context only. It forks from
 *     the workspace default like any fresh execution.
 *   - A **branch** is pure infrastructure — there's no body to quote.
 */
export function chipsForItem(item: LaunchSourceItem): LaunchChip[] {
  switch (item.kind) {
    case 'pr': {
      const chips: LaunchChip[] = [
        {
          id: chipId('base', item),
          chipKind: 'base',
          sourceKind: 'pr',
          label: `pr/${item.number}`,
          detail: item.ref ?? null,
          base: { baseBranch: null, prNumber: item.number ?? null },
        },
      ];
      const body = (item.body ?? '').trim();
      chips.push({
        id: chipId('context', item),
        chipKind: 'context',
        sourceKind: 'pr',
        label: `#${item.number} ${item.title}`,
        detail: body ? null : 'no description',
        context: {
          heading: `Pull request #${item.number}: ${item.title}`,
          body,
        },
      });
      return chips;
    }

    case 'issue':
      return [
        {
          id: chipId('context', item),
          chipKind: 'context',
          sourceKind: 'issue',
          label: `#${item.number} ${item.title}`,
          context: {
            heading: `Issue #${item.number}: ${item.title}`,
            body: (item.body ?? '').trim(),
          },
        },
      ];

    case 'branch':
      return [
        {
          id: chipId('base', item),
          chipKind: 'base',
          sourceKind: 'branch',
          label: item.ref ?? item.title,
          base: { baseBranch: item.ref ?? item.title, prNumber: null },
        },
      ];

    case 'task':
    case 'note':
    case 'connector':
      return [
        {
          id: chipId('context', item),
          chipKind: 'context',
          sourceKind: item.kind,
          label: item.title,
          detail: item.subtitle ?? null,
          context: {
            // Connector items name their provider in the heading ("Todoist
            // task: …") so the agent can tell an external system's task from
            // one that lives in this app and is safe to edit directly.
            heading: `${contextHeadingPrefix(item)}: ${item.title}`,
            body: (item.body ?? '').trim(),
          },
        },
      ];

    case 'chat':
      return [
        {
          id: chipId('continue', item),
          chipKind: 'continue',
          sourceKind: 'chat',
          label: item.title,
          detail: item.subtitle ?? null,
          continueFrom: {
            sessionId: item.sessionId ?? null,
            externalKey: null,
            externalSource: null,
            archived: !!item.archived,
          },
        },
      ];

    case 'external':
      return [
        {
          id: chipId('continue', item),
          chipKind: 'continue',
          sourceKind: 'external',
          label: item.title,
          detail: item.subtitle ?? null,
          continueFrom: {
            sessionId: null,
            externalKey: item.externalKey ?? null,
            externalSource: item.externalSource ?? null,
            // `createImportSkeleton` always lands a freshly-adopted provider
            // session as archived, so this path always needs reactivating.
            archived: true,
          },
        },
      ];
  }
}

/**
 * Add a pick to the current chip set, enforcing the two exclusivity rules:
 * one base at a time, and continue-vs-base can't coexist.
 *
 * Re-picking something already attached is a no-op rather than a duplicate,
 * so double-clicking a search result can't corrupt the draft.
 */
export function applyPick(chips: LaunchChip[], item: LaunchSourceItem): LaunchChip[] {
  const incoming = chipsForItem(item);
  const incomingIds = new Set(incoming.map((c) => c.id));
  const hasIncomingBase = incoming.some((c) => c.chipKind === 'base');
  const hasIncomingContinue = incoming.some((c) => c.chipKind === 'continue');

  const kept = chips.filter((c) => {
    if (incomingIds.has(c.id)) return false; // replaced by the incoming copy
    // Only one base may be attached, and a continuation replaces any base
    // (continuing an existing chat doesn't fork a new worktree).
    if (c.chipKind === 'base' && (hasIncomingBase || hasIncomingContinue)) return false;
    // Only one continuation, and attaching a base cancels it.
    if (c.chipKind === 'continue' && (hasIncomingContinue || hasIncomingBase)) return false;
    return true;
  });

  return [...kept, ...incoming];
}

export function removeChip(chips: LaunchChip[], id: string): LaunchChip[] {
  return chips.filter((c) => c.id !== id);
}

/** The effective fork point. Empty when nothing is attached (workspace default). */
export function resolveBase(chips: LaunchChip[]): LaunchBase {
  const base = chips.find((c) => c.chipKind === 'base');
  return base?.base ?? { baseBranch: null, prNumber: null };
}

/** The chat this launch should land in instead of creating a new execution. */
export function continuationOf(chips: LaunchChip[]): LaunchContinuation | null {
  return chips.find((c) => c.chipKind === 'continue')?.continueFrom ?? null;
}

/**
 * Build the first message.
 *
 * With no context chips this returns the typed text **verbatim** — the
 * express lane (type, hit Enter) has to be byte-identical to typing the
 * same thing into the composer, or the launcher would silently change how
 * every plain execution starts.
 */
export function composePrompt(text: string, chips: LaunchChip[]): string {
  const prompt = text.trim();
  const contexts = chips.filter((c) => c.chipKind === 'context' && c.context);
  if (contexts.length === 0) return prompt;

  const blocks = contexts.map((c) => {
    const body = c.context!.body.trim();
    return body ? `### ${c.context!.heading}\n\n${body}` : `### ${c.context!.heading}`;
  });

  const material = `## Context\n\n${blocks.join('\n\n')}`;
  return prompt ? `${prompt}\n\n${material}` : material;
}

/** A launch needs either typed text or a continuation to be meaningful. */
export function canLaunch(text: string, chips: LaunchChip[]): boolean {
  if (text.trim().length > 0) return true;
  // Context-only launches are allowed: "start on issue #377" is a complete
  // thought even with an empty prompt.
  return chips.some((c) => c.chipKind === 'context');
}

// ─── Per-workspace preferences ────────────────────────────────

/**
 * Sticky launcher settings, scoped **per workspace**. Mode and base branch
 * are meaningless globally (a `staging` default would follow you into a repo
 * that has no such branch), so the whole record is keyed by workspace id.
 * Model is stored here too rather than read from the global default so that
 * "the repo I always run Opus on" stays that way.
 */
export interface LaunchPrefs {
  mode: LaunchMode;
  baseBranch: string | null;
  harness: string | null;
  model: string | null;
  // Effort deliberately does NOT live here. It's global per provider rather
  // than per workspace, and shared with the in-execution composer — see
  // `provider-effort.ts`. Keeping a second copy here would let the two
  // surfaces disagree about the same preference.
}

export const DEFAULT_LAUNCH_PREFS: LaunchPrefs = {
  mode: 'worktree',
  baseBranch: null,
  harness: null,
  model: null,
};

const PREFS_KEY = 'flow.launcher.prefs.v1';

type PrefsMap = Record<string, LaunchPrefs>;

function readPrefsMap(): PrefsMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as PrefsMap;
  } catch {
    return {};
  }
}

export function readLaunchPrefs(workspaceId: string | null): LaunchPrefs {
  if (!workspaceId) return DEFAULT_LAUNCH_PREFS;
  const stored = readPrefsMap()[workspaceId];
  if (!stored) return DEFAULT_LAUNCH_PREFS;
  return {
    mode: stored.mode === 'live' ? 'live' : 'worktree',
    baseBranch: typeof stored.baseBranch === 'string' ? stored.baseBranch : null,
    harness: typeof stored.harness === 'string' ? stored.harness : null,
    model: typeof stored.model === 'string' ? stored.model : null,
  };
}

export function writeLaunchPrefs(workspaceId: string | null, prefs: LaunchPrefs): void {
  if (!workspaceId || typeof window === 'undefined') return;
  try {
    const map = readPrefsMap();
    map[workspaceId] = prefs;
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode — sticky settings are a nicety, not a requirement */
  }
}

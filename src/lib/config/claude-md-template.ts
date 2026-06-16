/**
 * CLAUDE.md template dropped into the app root on first init.
 *
 * Written by `ensureAppRoot()` when the file is missing — orientation for a
 * walk-up agent session opened in the data root before any orchestrator
 * chat exists. The content sits inside a managed region (agentex's
 * `upsertManagedBlock`, tag `flow`) so the orchestrator harness surface can
 * later swap the managed block per mode (see
 * `src/lib/orchestrator/harness-surface.ts`, which calls
 * `installInstructions` with the same tag) while anything the user adds
 * outside the markers survives every rewrite.
 *
 * The managed-region merge + per-runtime filename knowledge now live in
 * `@agentex/agent` (`installInstructions` / `upsertManagedBlock`). This file
 * is just the base-brief content + the shared tag.
 */

import { APP_NAME, APP_SHORT_ID } from '@/constants/app';

/**
 * Managed-region marker tag. Shared between the first-init write here and
 * the per-session `installInstructions` calls in harness-surface, so both
 * target the same `<!-- flow:managed:* -->` region. Also matches the
 * pre-0.0.21 hand-rolled markers, so existing installs migrate cleanly on
 * the next write (agentex's marker regex absorbs the old comment text).
 */
export const FLOW_MANAGED_TAG = APP_SHORT_ID;

/** Base orientation brief — the managed content written on first init. */
export function renderBaseBrief(): string {
  return `# Orchestrator session

You are operating ${APP_NAME} — a productivity system combining tasks, notes,
and a curated daily deck. This directory is the app's data root: config, the
SQLite database, the markdown mirror, and attachments live here.

## How to operate

Interact through the orchestrator surface — never by editing files here
directly. Direct edits bypass embeddings, the markdown mirror, and attachment
derivation. The UI and search rely on those invariants; corrupting them is
silent and only surfaces later.

- **MCP tools** (preferred when wired): one tool per action — tasks, notes,
  areas, deck, search, user state, workspaces, schedules, runs.
- **CLI fallback**: \`${APP_SHORT_ID} agent <action> [params]\`. Output is JSON.

The \`orchestrator\` skill has the full conventions (status values, energy,
effort, task-vs-note, title style, error envelope). Load it before acting if
you haven't already.

## This is an orchestrator session, not a dev session

Reasoning about what ${APP_NAME} can do → use the orchestrator skill. If a
capability you need isn't exposed, say so — don't invent a workaround by
reaching into the filesystem.

Debugging or extending ${APP_NAME} itself → start a new session in the
source repo; that's a different role with different conventions.`;
}

/**
 * First-init CLAUDE.md content: the base brief inside the `flow` managed
 * region. This is the create-from-nothing case, so it's a trivial local
 * wrap — we deliberately do NOT import agentex's `upsertManagedBlock` here.
 * `ensureAppRoot` (paths.ts) pulls this module into the CLI's *static*
 * import graph, and `@agentex/agent` is ESM-only with no CJS condition, so
 * a static agentex import crashes the tsx-run CLI at boot
 * (`ERR_PACKAGE_PATH_NOT_EXPORTED`). Same reason the registry + skills.ts
 * lazy-import agentex.
 *
 * The markers are hashless but regex-compatible with agentex's
 * `installInstructions`; the first orchestrator session spawn replaces this
 * region in place (and upgrades it to the hash format). Stays synchronous,
 * so `ensureAppRoot` does too.
 */
export function renderAppRootClaudeMd(): string {
  const body = renderBaseBrief().trim();
  return `<!-- ${FLOW_MANAGED_TAG}:managed:start -->\n${body}\n<!-- ${FLOW_MANAGED_TAG}:managed:end -->\n`;
}

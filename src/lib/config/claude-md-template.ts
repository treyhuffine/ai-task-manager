/**
 * CLAUDE.md template dropped into the app root on first init.
 *
 * Written by `ensureAppRoot()` when the file is missing. The content sits
 * inside managed markers so the app can regenerate it later (the
 * orchestrator harness surface swaps the managed block per mode — see
 * `src/lib/orchestrator/harness-surface.ts`) while anything the user adds
 * outside the markers survives every rewrite.
 *
 * The file's job: orient an agent opening a session in the app data root. It
 * states the role (orchestrator, not developer), names the surfaces (MCP +
 * CLI), and warns off direct file edits. Everything deeper — conventions,
 * writing rules, error shapes — lives in the installed `orchestrator` skill.
 */

import { APP_NAME, APP_SHORT_ID } from '@/constants/app';

/**
 * Managed-section markers. Everything between them is app-owned and
 * regenerated; everything outside is user-owned and preserved.
 */
export const MANAGED_START = `<!-- ${APP_SHORT_ID}:managed:start — app-generated; edits inside this block are overwritten -->`;
export const MANAGED_END = `<!-- ${APP_SHORT_ID}:managed:end -->`;

/** Wrap managed content in the marker pair. */
export function wrapManaged(content: string): string {
  return `${MANAGED_START}\n${content.trim()}\n${MANAGED_END}\n`;
}

/**
 * Replace the managed block in an existing file body, or prepend one if the
 * file has no markers yet. Returns the new full file content.
 *
 * Pre-marker files (the original write-once template, or a user's own file)
 * keep their content below the managed block — nothing is dropped.
 */
export function upsertManagedBlock(existing: string | null, managedContent: string): string {
  const block = wrapManaged(managedContent);
  if (existing === null || existing.trim() === '') return block;

  const startIdx = existing.indexOf(MANAGED_START);
  const endIdx = existing.indexOf(MANAGED_END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + MANAGED_END.length);
    return `${before}${block.trimEnd()}${after.startsWith('\n') ? '' : '\n'}${after}`;
  }

  // Pristine v1 write-once template → replace outright (its content is
  // subsumed by the managed brief). Identified by its two distinctive
  // headings; anything else is treated as user content and preserved.
  const isPristineV1 =
    existing.includes('# Orchestrator session') &&
    existing.includes('## This is an orchestrator session, not a dev session');
  if (isPristineV1) return block;

  return `${block}\n${existing.trimStart()}`;
}

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

export function renderAppRootClaudeMd(): string {
  return wrapManaged(renderBaseBrief());
}

/**
 * CLAUDE.md template dropped into the app root on first init.
 *
 * Written once by `ensureAppRoot()` if the file is missing. Never overwritten
 * — the user can edit freely without losing their changes on the next boot.
 *
 * The file's job: orient an agent opening a session in the app data root. It
 * states the role (orchestrator, not developer), names the surfaces (MCP +
 * CLI), and warns off direct file edits. Everything deeper — conventions,
 * writing rules, error shapes — lives in the installed `orchestrator` skill.
 */

import { APP_NAME, APP_SHORT_ID } from '@/constants/app';

export function renderAppRootClaudeMd(): string {
  return `# Orchestrator session

You are operating ${APP_NAME} — a productivity system combining tasks, notes,
and a curated daily deck. This directory is the app's data root: config, the
SQLite database, the markdown mirror, and attachments live here.

## How to operate

Interact through the orchestrator surface — never by editing files here
directly. Direct edits bypass embeddings, the markdown mirror, and attachment
derivation. The UI and search rely on those invariants; corrupting them is
silent and only surfaces later.

- **MCP tools** (preferred): \`describe_paths\`, \`describe_schema\`,
  \`list_tasks\`, \`get_task\`, \`create_task\`, \`update_task\`,
  \`complete_task\`, \`list_notes\`, \`get_note\`, \`create_note\`.
- **CLI fallback**: \`${APP_SHORT_ID} agent <action> [params]\`. Output is JSON.

The \`orchestrator\` skill has the full conventions (status values, energy,
effort, task-vs-note, title style, error envelope). Load it before acting if
you haven't already.

## This is an orchestrator session, not a dev session

Reasoning about what ${APP_NAME} can do → use the orchestrator skill. If a
capability you need isn't exposed, say so — don't invent a workaround by
reaching into the filesystem.

Debugging or extending ${APP_NAME} itself → start a new session in the
source repo; that's a different role with different conventions.
`;
}

/**
 * Orchestrator harness surface — the on-disk contract for running the
 * dashboard orchestrator on an agent harness (Claude Code today, Codex
 * next) with cwd = the app data root.
 *
 * Three pieces, all idempotent and safe to re-run at session spawn:
 *
 *   1. CLAUDE.md + AGENTS.md at the app root — the role brief. Written via
 *      agentex's `installInstructions` (managed-region merge, tag `flow`)
 *      so app upgrades regenerate the block while user additions outside it
 *      survive.
 *   2. Per-session ProviderConfig fields (`orchestratorSessionConfig`) —
 *      typed agentex ≥0.0.20 config, no raw argv:
 *        - `mcpServers` points the harness at this server's orchestrator
 *          MCP with the local bearer token (`harness_mcp` mode only).
 *          agentex stages the config as a 0600 temp file and passes
 *          `--mcp-config` itself — we no longer write
 *          `tmp/orchestrator-mcp.json` (stale copies are cleaned up on
 *          install; they carry a token).
 *        - `strictMcpConfig` so the session sees exactly what we attach
 *          (no user-level MCP leakage, and `harness_skills` mode gets a
 *          genuinely MCP-free session for a clean A/B).
 *        - `disallowedTools: Write/Edit/NotebookEdit` — the write guard:
 *          every write must flow through actions. The markdown mirror is
 *          one-way; direct edits get clobbered and bypass
 *          embeddings/attachment derivation.
 *
 * Mode selection lives on `user_state.orchestratorMode`. `legacy` keeps
 * the hand-rolled streamText agent and never reaches this module's
 * session-args path.
 */

import fs from 'node:fs';
import path from 'node:path';
// agentex is ESM-only (no CJS condition); a static value import crashes the
// tsx-run CLI's static graph at boot. Type-only import is erased at compile,
// so it's safe; the value (`installInstructions`) is loaded via dynamic
// import inside the async installer below. Matches the lazy-load convention
// in registry.ts / skills.ts.
import type { McpServerConfig, ProviderConfig } from '@agentex/agent';
import { APP_NAME, APP_SHORT_ID } from '@/constants/app';
import { renderBaseBrief, FLOW_MANAGED_TAG } from '@/lib/config/claude-md-template';
import {
  APP_ROOT_ENV,
  DB_PATH_ENV,
  ensureAppRoot,
  ensureBrainDir,
  getAppRoot,
  getBrainDir,
} from '@/lib/config/paths';
import { readAuthConfig } from '@/lib/auth/config-file';

export type OrchestratorMode = 'legacy' | 'harness_skills' | 'harness_mcp';

export const ORCHESTRATOR_MCP_SERVER_NAME = 'orchestrator';

// ─── Server endpoint resolution ───────────────────────────────────

/**
 * Port the running app server listens on. Inside the server process
 * PORT is authoritative; `lastPort` (written by `start`) covers the
 * cases where it isn't exported; 4224 is the dev default.
 */
export function resolveServerPort(): number {
  const envPort = Number(process.env.PORT);
  if (Number.isInteger(envPort) && envPort > 0) return envPort;
  const lastPort = readAuthConfig()?.lastPort;
  if (typeof lastPort === 'number' && lastPort > 0) return lastPort;
  return 4224;
}

// ─── CLI command resolution ───────────────────────────────────────

/** Single-quote a value for safe inline use in a shell command. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Inline env assignments pinning the CLI to THIS server's data root.
 *
 * Baked into the command string rather than relying on inheritance: the
 * harness's Bash tool starts a fresh shell from the user's profile, so the
 * server's `<APP>_ROOT` does NOT reach CLI subprocesses on its own.
 * (Caught by the level-4 smoke — a skills-mode run wrote its task into the
 * default/prod home instead of the active one.) A db override rides along
 * when the server itself runs with it set.
 */
function cliEnvPrefix(): string {
  const parts = [`${APP_ROOT_ENV}=${shellQuote(getAppRoot())}`];
  const dbOverride = process.env[DB_PATH_ENV];
  if (dbOverride) parts.push(`${DB_PATH_ENV}=${shellQuote(dbOverride)}`);
  return parts.join(' ');
}

/**
 * The command the harness should run for CLI actions. Production installs
 * have the `<cli>` binary on PATH; dev runs route through the repo's
 * `cli:dev` script (tsx). Always carries the data-root env inline — see
 * `cliEnvPrefix`.
 */
export function resolveCliCommand(): string {
  if (process.env[`${APP_SHORT_ID.toUpperCase()}_CLI_COMMAND`]) {
    return process.env[`${APP_SHORT_ID.toUpperCase()}_CLI_COMMAND`]!;
  }
  const base =
    process.env.NODE_ENV !== 'production'
      ? `pnpm --silent --dir ${process.cwd()} cli:dev`
      : APP_SHORT_ID;
  return `${cliEnvPrefix()} ${base}`;
}

// ─── Role brief ───────────────────────────────────────────────────

const DOMAIN_BRIEF = `## Personalization & memory

Two user-owned files shape who you're working with and how you show up.
Treat them as authoritative; **never edit them** — they belong to the user.
On Claude they're imported automatically below; on other harnesses, read
them at the start of a session.

@USER.md
@SOUL.md

Your durable cross-session memory is \`MEMORY.md\` — the record of what
you've learned and decided across conversations. Consult it for past context
and keep it current through your tools. It can grow large, so read it when
relevant rather than assuming it's already in context.

## Domain model

- **Tasks** — action items: title, description, body (markdown), outcome
  (definition of done), status (\`active | done | archived\`), energy
  (\`deep | light\`), effort (\`trivial | small | medium | large | epic\`),
  hardDeadline, recurrence ("daily", "weekly", "monthly", "yearly", or "3d"),
  blockedOn, parentId (subtasks), areaId, contextTags, userContext.
- **Notes** — freeform markdown (ideas, meeting notes, research): body,
  optional title, optional area/task link.
- **Areas** — life/work domains ("Work", "Health"). Tasks and notes belong
  to areas.
- **Deck** — the day's ranked priority stack: 3–7 tasks plus alternatives.
  Regenerating runs the full AI prioritization pipeline (slow; only on
  explicit request).
- **Stream** — the quick-capture inbox: brain dumps awaiting triage (see
  Stream triage).
- **User state** — the user's current context: active area/task, energy,
  available minutes, free-text focus.
- **Workspaces & executions** — workspaces are repos/folders the user
  delegates coding work into; executions are agent sessions running inside
  them. You can watch and steer them (see Execution oversight).

## Stream triage

The stream is the user's zero-friction capture inbox; your job is to keep it
empty without losing anything:

- \`list_stream\` (defaults to pending) → for each item decide:
  - **Actionable** → \`promote_stream\` with \`to=task\` and a shaped
    imperative title ("Ship the manifest", not the raw dump). Use
    \`parentId\` when it's clearly a step of an existing task.
  - **Worth keeping, not actionable** → \`promote_stream\` with \`to=note\`
    (link \`taskId\`/\`areaId\` when context is clear).
  - **Noise / duplicate / stale** → \`dismiss_stream\`.
- Promotion preserves the user's raw text as the body and carries
  attachments — shape the *title*, don't rewrite their words.
- When the right shape is genuinely ambiguous, ask the user instead of
  guessing — or leave it pending; an unforced wrong file is worse than an
  untriaged item.
- Reference what you created with entity markers so the user can inspect.
- \`create_stream_item\` works the other way: when the user gives you
  something that should be kept but isn't clearly a task or note yet, file
  it into the stream rather than force-fitting it.

"Triage my stream every morning" is a one-liner schedule
(\`create_schedule\`, \`target_kind=orchestrator\`).

## Execution oversight

You are the conductor over the executing agents:

- \`list_executions\` — every active execution with status flags: \`running\`
  (turn in flight), \`awaitingInput\` (blocked on a permission/question), and
  \`unread\` (finished output the user hasn't viewed — matches the rail's
  Unread section). "What needs my attention?" = unread + awaitingInput.
- \`get_session_messages\` — the condensed transcript tail of a session.
  **Always read before acting** — know where the agent actually is.
- \`send_session_message\` — drop a message into an execution: nudge a
  stalled one, add context, redirect. Delivery is asynchronous; re-check
  the transcript for the response.
- \`get_pending_input\` / \`answer_pending_input\` — when a session is
  \`awaitingInput\`, its turn is **blocked**: queued messages won't reach it
  until the prompt is resolved. Fetch the prompt, then answer it —
  questions (allow=true + answers keyed by question text) when the user's
  intent is clear from context; **permission prompts default to surfacing
  to the user** — approve only what the user explicitly asked for or has
  delegated to you.

Rules: never send to your own session id. Don't poll executions the user
didn't ask about.

For recurring duties ("check my executions every morning and nudge stalled
ones"), create a schedule with \`target_kind=orchestrator\` — scheduled fires
run with this same tool surface.

## This conversation is long-running

You are a persistent assistant in one continuous thread — it can span days
or weeks, and the user just keeps talking to you. That changes how you work:

- **The world moves between messages.** The user edits tasks in the UI,
  schedules fire, executions finish — all while you're not looking. What
  you fetched earlier in the conversation is a cache; the tools are the
  truth. Re-read state before acting on anything you remember.
- **Your clock may be stale.** The date you were given at session start can
  be days old by the current message. When timing matters (deadlines,
  "today", recurrence), check the current date with \`date\` first.
- **Older context may be compacted** into summaries. If you need exactly
  what was said or decided, look it up (\`search\`, \`get_session_messages\`,
  the entity itself) rather than reconstructing from memory.
- **Pick up mid-conversation.** Never re-introduce yourself, recap
  unprompted, or greet like a new session — continue the relationship.

## Rules that matter

- **IDs are UUIDs, never names.** Look ids up first (\`list_areas\`,
  \`list_tasks\`, \`search\`) before passing them anywhere.
- **Complete via \`complete_task\`**, never \`update_task\` with
  status=done — completion records history and rolls recurring tasks.
- **Archive instead of delete.** There are no delete actions by design.
- **Search before creating** to avoid duplicates, and before answering
  "what was I doing about X".
- **Act, don't describe.** When the user asks for something actionable, do
  it with your tools, then confirm briefly.

## Entity references (required)

When you mention a specific task, note, area, deck, or execution, write a
reference so the UI renders an interactive chip:

- \`[[task:UUID]]\` · \`[[note:UUID]]\` · \`[[area:UUID]]\` · \`[[deck:UUID]]\`
- \`[[execution:SESSION_ID]]\` — use the \`sessionId\` from
  \`list_executions\` / \`get_session_messages\`. The chip shows the
  execution's live status and opens it on click — always include one when
  reporting on an execution.

Formatting rules — these are load-bearing for the UI:

- Plain text only: never inside backticks, code blocks, lists, tables, or
  blockquotes.
- Each reference on its own line at the top level of your reply.
- Prefer a reference over restating an entity's title in prose.

User messages may reference uploaded files as \`[[file:<name>]]\` — the file
lives at \`attachments/<name>\` under your home dir; Read it when you need the
content.

## Output style

- Plain markdown, concise and action-oriented; bullets over paragraphs.
- Never echo raw JSON or tool output — summarize, then reference entities.
- A brief confirmation plus entity references is the ideal shape of a reply.`;

function modeSection(mode: OrchestratorMode, cliCommand: string): string {
  switch (mode) {
    case 'harness_mcp':
      return `## Your tools (MCP)

The \`${ORCHESTRATOR_MCP_SERVER_NAME}\` MCP server is attached to this session — one typed
tool per action: \`list_tasks\`, \`get_task\`, \`create_task\`, \`update_task\`,
\`complete_task\`, \`list_notes\`, \`get_note\`, \`create_note\`, \`update_note\`,
\`list_stream\`, \`get_stream_item\`, \`create_stream_item\`, \`promote_stream\`,
\`dismiss_stream\`, \`list_areas\`, \`get_area\`, \`create_area\`, \`update_area\`, \`get_deck\`,
\`update_deck\`, \`regenerate_deck\`, \`reconcile_deck\`, \`search\`, \`get_user_state\`,
\`update_user_state\`; execution oversight via \`list_executions\`,
\`get_session_messages\`, \`send_session_message\`, \`get_pending_input\`,
\`answer_pending_input\`; plus workspace/schedule/run management and
\`describe_paths\` / \`describe_schema\` / \`list_skills\`.

Use these MCP tools for every read and write. Reading files in your home dir
for ambient context is fine; writing through anything but the tools is not.`;
    case 'harness_skills':
      return `## Your tools (CLI)

Run actions through the CLI via Bash. The command is:

    ${cliCommand} agent <action> [params]

- Output is JSON on stdout. Errors are JSON on stderr with exit code 1.
- Simple params are flags; complex input goes through \`--input '<json>'\`:

      ${cliCommand} agent list_tasks --status active
      ${cliCommand} agent search "standup notes" --limit 5
      ${cliCommand} agent create_task --input '{"title":"Ship the manifest","effort":"small"}'
      ${cliCommand} agent complete_task <task-id>

- \`${cliCommand} agent --help\` lists every action; \`<action> --help\` shows params.

Use the CLI for every read and write. Reading files in your home dir for
ambient context is fine; writing through anything but the CLI is not.`;
    case 'legacy':
      return '';
  }
}

/**
 * The full managed brief for a mode. `legacy` renders the base orientation
 * (the data root still hosts walk-up agent sessions); harness modes get the
 * domain model + mode-specific tool guidance.
 */
export function renderOrchestratorBrief(mode: OrchestratorMode, cliCommand = resolveCliCommand()): string {
  if (mode === 'legacy') return renderBaseBrief();

  return `# Orchestrator session

You are ${APP_NAME}'s orchestrator — a productivity agent operating on the
user's behalf inside their task + note + deck system. This directory is the
app's home: the SQLite database, markdown mirror, and attachments live
right here.

**Never edit files here directly.** The markdown mirror is a one-way export —
the app overwrites external edits — and direct writes bypass embeddings,
mirror sync, and attachment derivation. Every mutation goes through the
actions described below. If a capability you need isn't exposed, say so
rather than working around it through the filesystem.

${modeSection(mode, cliCommand)}

${DOMAIN_BRIEF}

The \`orchestrator\` skill carries the deeper writing conventions (title
style, energy/effort defaults, task-vs-note, error envelope) — load it when
you start doing real work.

Debugging or extending ${APP_NAME} itself is a different role — that happens
in the source repo, not here.`;
}

// ─── MCP server config ────────────────────────────────────────────

/**
 * The orchestrator MCP as a typed agentex `McpServerConfig` (http
 * transport + local bearer token). agentex ≥0.0.20 stages this as a 0600
 * temp file and passes `--mcp-config` itself — the token never touches
 * argv, and we no longer maintain `tmp/orchestrator-mcp.json`.
 *
 * Returns null (with a warning) when no local token exists yet — the
 * session still runs, just without MCP tools.
 */
export function orchestratorMcpServer(port = resolveServerPort()): McpServerConfig | null {
  const token = readAuthConfig()?.localToken;
  if (!token) {
    console.warn('[harness-surface] no localToken in config.json — skipping MCP attachment');
    return null;
  }
  return {
    name: ORCHESTRATOR_MCP_SERVER_NAME,
    type: 'http',
    url: `http://localhost:${port}/api/orchestrator/mcp`,
    headers: { Authorization: `Bearer ${token}` },
  };
}

/**
 * Pre-0.0.20 installs staged the MCP config (bearer token inside) at
 * `tmp/orchestrator-mcp.json`. agentex stages its own copy now, so the
 * on-disk one is dead weight holding a credential — remove it.
 */
function removeStaleMcpConfig(root: string): void {
  try {
    fs.rmSync(path.join(root, 'tmp', 'orchestrator-mcp.json'), { force: true });
  } catch {
    /* best-effort */
  }
}

// ─── Install ──────────────────────────────────────────────────────

export interface InstalledSurface {
  claudeMdPath: string;
  agentsMdPath: string;
}

/**
 * Materialize the surface for a mode at the app data root. Idempotent —
 * called on every orchestrator session ensure and on mode switches.
 *
 * The CLAUDE.md + AGENTS.md merge is delegated to agentex's
 * `installInstructions`: it owns the per-runtime filename mapping
 * (claude → CLAUDE.md, codex → AGENTS.md) and the managed-region merge that
 * preserves user content outside the markers. `managedTag: FLOW_MANAGED_TAG`
 * ('flow') targets the same region our first-init write uses AND the
 * pre-0.0.21 hand-rolled markers, so existing installs migrate on the next
 * write rather than gaining a second block.
 */
export async function installOrchestratorSurface(mode: OrchestratorMode): Promise<InstalledSurface> {
  const root = ensureAppRoot();
  // Seed MEMORY/USER/SOUL.md at the home root (write-once) before writing a brief that
  // references/@imports them — guarantees the import targets exist, including
  // on installs that predate these files. Never clobbers user edits.
  ensureBrainDir();
  const brief = renderOrchestratorBrief(mode);

  const { installInstructions } = await import('@agentex/agent');
  await installInstructions(brief, {
    location: 'workspace',
    cwd: root,
    runtimes: ['claude', 'codex'],
    managedTag: FLOW_MANAGED_TAG,
  });
  removeStaleMcpConfig(root);

  return {
    claudeMdPath: path.join(root, 'CLAUDE.md'),
    agentsMdPath: path.join(root, 'AGENTS.md'),
  };
}

// ─── Per-session provider config ──────────────────────────────────

/**
 * Tools the orchestrator session may never use: every write goes through
 * actions, so file-editing tools are denied outright. Bash stays available
 * (the skills mode depends on it; reads and the CLI flow through it).
 */
const ORCHESTRATOR_DISALLOWED_TOOLS = ['Write', 'Edit', 'NotebookEdit'];

/**
 * The mode's slice of agentex `ProviderConfig` for an orchestrator harness
 * session. Merged into the executor's config at spawn:
 *
 * - Both harness modes: deny file-editing tools, and set
 *   `strictMcpConfig` so the session's MCP surface is exactly what we
 *   attach — a stray `.mcp.json` in the data root (e.g. from the level-3
 *   smoke) or user-level servers can't leak in.
 * - `harness_mcp`: additionally attach the orchestrator MCP server
 *   (skipped with a warning when no local token exists yet).
 *
 * Typed config, not argv — agentex maps it per provider. Providers
 * without argv tool filtering / MCP wiring (Codex today) ignore the
 * fields, so passing them is safe and lights up when upstream wiring
 * lands. Returns {} for `legacy` (no harness session exists in that mode).
 */
export function orchestratorSessionConfig(
  mode: OrchestratorMode,
  opts: { port?: number } = {},
): Partial<ProviderConfig> {
  if (mode === 'legacy') return {};
  const config: Partial<ProviderConfig> = {
    disallowedTools: [...ORCHESTRATOR_DISALLOWED_TOOLS],
    strictMcpConfig: true,
  };
  if (mode === 'harness_mcp') {
    const server = orchestratorMcpServer(opts.port);
    if (server) config.mcpServers = [server];
  }
  return config;
}

/** Convenience: the brain dir, for callers writing docs/UI copy. */
export function orchestratorDataRoot(): { appRoot: string; brainDir: string } {
  return { appRoot: getAppRoot(), brainDir: getBrainDir() };
}

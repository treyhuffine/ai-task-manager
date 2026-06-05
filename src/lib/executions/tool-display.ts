/**
 * Humanize a `tool_call` row (toolName + toolInput) into a compact,
 * Conductor-style descriptor — and summarize its paired `tool_result`.
 *
 * Covers both harnesses the app drives:
 *   - **Claude**: Read / Write / Edit / Bash / Grep / Glob / Task / …
 *   - **Codex**: `command_execution` (live, input is the command string),
 *     `exec_command` (on-disk, `{cmd}`), `shell`/`local_shell`
 *     (`{command:[…]}`), `apply_patch` (V4A patch text), `update_plan`
 *     (`{plan:[{step,status}]}`), plus PTY plumbing (`write_stdin`,
 *     `read_thread_terminal`).
 *   - **MCP**: `mcp__server__tool` kept as a recognizable mono name.
 *
 * Pure + synchronous so it renders inline and unit-tests cleanly. The
 * component maps `glyph` → a lucide icon.
 */

export type ToolGlyph =
  | 'read'
  | 'edit'
  | 'write'
  | 'bash'
  | 'search'
  | 'web'
  | 'task'
  | 'plan'
  | 'todo'
  | 'question'
  | 'terminal'
  | 'tool';

/** Broad behavior class — drives counting + which rows are high-signal. */
export type ToolKind =
  | 'read'
  | 'edit'
  | 'exec'
  | 'search'
  | 'plan'
  | 'subagent'
  | 'web'
  | 'plumbing'
  | 'other';

export interface ToolDisplay {
  glyph: ToolGlyph;
  /** Short human verb, e.g. "Read", "Edit", "Run". Monospace when `mono`. */
  verb: string;
  /** Salient argument — file basename, pattern, url host, etc. */
  target?: string;
  /** Dim secondary — the raw command / full path / query. */
  detail?: string;
  /** Render `verb` monospace (commands, MCP, unknown names). */
  mono?: boolean;
  kind: ToolKind;
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/** Last path segment of a unix/posix-ish path. Leaves bare names intact. */
export function basename(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return idx >= 0 ? trimmed.slice(idx + 1) || trimmed : trimmed;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** Pretty-print an `mcp__server__tool` wire name → "server: tool". */
function prettyMcp(name: string): string {
  const rest = name.slice('mcp__'.length);
  const sep = rest.indexOf('__');
  if (sep < 0) return rest.replace(/__/g, ' ');
  return `${rest.slice(0, sep)}: ${rest.slice(sep + 2).replace(/__/g, ' ')}`;
}

/**
 * Pull the command string out of the many shell-tool input shapes:
 *   - `command_execution` (live Codex): input IS the string
 *   - `exec_command` (on-disk Codex): `{ cmd: "…" }`
 *   - `shell`/`local_shell`: `{ command: ["bash","-lc","…"] }` or string
 *   - Claude `Bash`: `{ command: "…", description? }`
 */
function shellCommand(input: unknown): string | undefined {
  if (typeof input === 'string') return str(input);
  const o = asRecord(input);
  const cmd = o.command ?? o.cmd;
  if (typeof cmd === 'string') return str(cmd);
  if (Array.isArray(cmd)) {
    // ["bash","-lc","git status"] → prefer the meaningful tail.
    const parts = cmd.filter((x): x is string => typeof x === 'string');
    const lc = parts.indexOf('-lc');
    const joined = lc >= 0 && parts[lc + 1] ? parts[lc + 1] : parts.join(' ');
    return str(joined);
  }
  return undefined;
}

/** First in-progress (else first) step of a Codex `update_plan` payload. */
function currentPlanStep(input: unknown): string | undefined {
  const plan = asRecord(input).plan;
  if (!Array.isArray(plan)) return undefined;
  const steps = plan.filter((s): s is Record<string, unknown> => !!s && typeof s === 'object');
  const active = steps.find((s) => s.status === 'in_progress') ?? steps[0];
  return active ? str(active.step) : undefined;
}

/** File path(s) touched by an `apply_patch` V4A patch body. */
function patchFiles(input: unknown): string[] {
  const text =
    typeof input === 'string' ? input : str(asRecord(input).input) ?? str(asRecord(input).patch);
  if (!text) return [];
  const files: string[] = [];
  const re = /^\*\*\*\s+(?:Add|Update|Delete) File:\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) files.push(m[1].trim());
  return files;
}

export function describeToolCall(toolName: string | null | undefined, input: unknown): ToolDisplay {
  const name = (toolName ?? '').trim();
  const o = asRecord(input);

  // MCP tools — recognizable mono name, first string arg as a hint.
  if (name.startsWith('mcp__')) {
    const hint = str(o.url) ?? str(o.query) ?? str(o.path) ?? str(o.file_path);
    return { glyph: 'tool', verb: prettyMcp(name), mono: true, kind: 'other', target: hint && basename(hint) };
  }

  switch (name) {
    // ── Reads ──────────────────────────────────────────────────────────
    case 'Read':
    case 'read_file': {
      const f = str(o.file_path) ?? str(o.path) ?? str(o.notebook_path);
      return { glyph: 'read', verb: 'Read', target: f && basename(f), detail: f, kind: 'read' };
    }
    case 'LS':
    case 'List': {
      const path = str(o.path);
      return { glyph: 'read', verb: 'List', target: path && basename(path), detail: path, kind: 'read' };
    }

    // ── Edits ──────────────────────────────────────────────────────────
    case 'Write': {
      const f = str(o.file_path) ?? str(o.path);
      return { glyph: 'write', verb: 'Write', target: f && basename(f), detail: f, kind: 'edit' };
    }
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const f = str(o.file_path) ?? str(o.notebook_path) ?? str(o.path);
      return { glyph: 'edit', verb: 'Edit', target: f && basename(f), detail: f, kind: 'edit' };
    }
    case 'apply_patch': {
      const files = patchFiles(input);
      const target = files[0] ? basename(files[0]) : undefined;
      const detail = files.length > 1 ? `+${files.length - 1} more` : undefined;
      return { glyph: 'edit', verb: 'Edit', target, detail, kind: 'edit' };
    }

    // ── Shell / exec ───────────────────────────────────────────────────
    case 'Bash': {
      // Claude's Bash carries a human `description` — prefer it as the
      // label (matches Conductor), with the command as dim detail.
      const cmd = shellCommand(input);
      const desc = str(o.description);
      return desc
        ? { glyph: 'bash', verb: desc, detail: cmd, kind: 'exec' }
        : { glyph: 'bash', verb: 'Run', mono: true, detail: cmd, kind: 'exec' };
    }
    case 'command_execution':
    case 'exec_command':
    case 'shell':
    case 'local_shell': {
      const cmd = shellCommand(input);
      return { glyph: 'bash', verb: 'Run', mono: true, detail: cmd, kind: 'exec' };
    }
    case 'write_stdin':
      return { glyph: 'terminal', verb: 'Terminal input', detail: str(o.chars), kind: 'plumbing' };
    case 'read_thread_terminal':
      return { glyph: 'terminal', verb: 'Read terminal', kind: 'plumbing' };

    // ── Search ─────────────────────────────────────────────────────────
    case 'Grep': {
      const pat = str(o.pattern);
      return { glyph: 'search', verb: 'Search', target: pat, detail: str(o.path) ?? str(o.glob), kind: 'search' };
    }
    case 'Glob': {
      const pat = str(o.pattern);
      return { glyph: 'search', verb: 'Find files', target: pat, detail: str(o.path), kind: 'search' };
    }

    // ── Web ────────────────────────────────────────────────────────────
    case 'WebFetch': {
      const url = str(o.url);
      return { glyph: 'web', verb: 'Fetch', target: url && hostOf(url), detail: url, kind: 'web' };
    }
    case 'WebSearch':
      return { glyph: 'web', verb: 'Search web', target: str(o.query), kind: 'web' };

    // ── Plans / subagents / questions ─────────────────────────────────
    case 'update_plan':
      return { glyph: 'plan', verb: 'Update plan', target: currentPlanStep(input), kind: 'plan' };
    case 'TodoWrite':
      return { glyph: 'todo', verb: 'Update todos', kind: 'plan' };
    case 'Task':
      return { glyph: 'task', verb: 'Subagent', target: str(o.description) ?? str(o.subagent_type), kind: 'subagent' };
    case 'AskUserQuestion':
      return { glyph: 'question', verb: 'Ask', kind: 'other' };

    default: {
      const hint = str(o.file_path) ?? str(o.path) ?? shellCommand(input) ?? str(o.url) ?? str(o.query);
      return { glyph: 'tool', verb: name || 'Tool', mono: !!name, kind: 'other', target: hint && basename(hint) };
    }
  }
}

/** True for tools that spawn a subagent — used for the grouped-turn count. */
export function isSubagentTool(toolName: string | null | undefined): boolean {
  return toolName === 'Task';
}

/** PTY plumbing rows (Codex) — high-volume, low-signal; folded + uncounted. */
export function isPlumbingTool(toolName: string | null | undefined): boolean {
  return toolName === 'write_stdin' || toolName === 'read_thread_terminal';
}

// ─── Result summaries ────────────────────────────────────────────────────

/** Count content lines, ignoring a single trailing newline. */
function lineCount(text: string): number {
  if (!text) return 0;
  const t = text.endsWith('\n') ? text.slice(0, -1) : text;
  return t.length ? t.split('\n').length : 0;
}

function nonEmptyLineCount(text: string): number {
  if (!text) return 0;
  return text.split('\n').filter((l) => l.trim()).length;
}

/** Strip the Codex on-disk exec header ("Wall time / Process exited / Output:"). */
function codexExecBody(content: string): string {
  const i = content.indexOf('\nOutput:\n');
  return i >= 0 ? content.slice(i + '\nOutput:\n'.length) : content;
}

function parseCodexExit(content: string): number | null {
  const m = content.match(/Process exited with code (\d+)/);
  return m ? Number(m[1]) : null;
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/**
 * Compact result suffix for a paired `tool_result`, e.g. "150 lines",
 * "exit 1", "23 matches", "8 files". Returns null when there's nothing
 * worth showing (a clean command, an empty/confirmation body).
 *
 * `exitCode` comes from `chat_events.toolExitCode` (Codex live sets it);
 * falls back to parsing the on-disk exec header.
 */
export function describeToolResult(
  toolName: string | null | undefined,
  content: string | null | undefined,
  exitCode?: number | null,
): string | null {
  const name = (toolName ?? '').trim();
  const text = content ?? '';

  switch (name) {
    case 'Read':
    case 'read_file': {
      const n = lineCount(text);
      return n ? plural(n, 'line') : null;
    }
    case 'Glob': {
      const n = nonEmptyLineCount(text);
      return n ? plural(n, 'file') : null;
    }
    case 'Grep': {
      const n = nonEmptyLineCount(text);
      return n ? plural(n, 'match', 'matches') : null;
    }
    case 'LS':
    case 'List': {
      const n = nonEmptyLineCount(text);
      return n ? plural(n, 'item') : null;
    }
    case 'Bash':
    case 'command_execution':
    case 'exec_command':
    case 'shell':
    case 'local_shell': {
      const code = exitCode ?? parseCodexExit(text);
      if (code != null && code !== 0) return `exit ${code}`;
      return null; // clean run — keep it quiet
    }
    default:
      return null;
  }
}

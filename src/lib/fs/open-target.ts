/**
 * Open a folder in a native OS app — file manager, terminal, or one of
 * the common code editors. Each `OpenTarget` resolves to a per-platform
 * shell command that gets spawned and detached, so the response returns
 * as soon as the dispatch succeeds (we don't wait for the user to close
 * the editor).
 *
 * "Available" here means: the command for the current platform exists.
 * We don't probe the binary at request time — if the user picks an app
 * they don't have, the spawn fails quickly with ENOENT and the route
 * surfaces it as `not_installed`. That's the same fail-shape every other
 * IDE-launcher in the wild has.
 */

import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { sanitizeChildEnv } from '@/lib/utils/sanitize-child-env';
import os from 'node:os';

export type OpenTarget =
  | 'finder'      // Reveal in default file manager
  | 'terminal'    // Default terminal app for the platform
  | 'iterm'       // macOS only
  | 'vscode'
  | 'cursor'
  | 'antigravity'
  | 'zed'
  | 'sublime'
  | 'webstorm';

export interface OpenInTargetResult {
  ok: boolean;
  /** Set when ok=false. `not_installed` = ENOENT on the binary. */
  reason?: 'not_installed' | 'unsupported' | 'failed';
  message?: string;
}

export interface OpenInOptions {
  /** 1-based line to jump to (editors that support it). */
  line?: number;
  /** 1-based column to jump to (used with `line`). */
  column?: number;
  /** Reveal/select the path in the file manager instead of opening it. */
  reveal?: boolean;
  /**
   * Project/worktree root to open alongside the file so the editor's tree
   * loads. Ignored when it equals `path` (i.e. opening the folder itself).
   */
  projectDir?: string;
}

interface CommandSpec {
  bin: string;
  args: string[];
}

/** `file:line:col` suffix that VS Code/Zed/Sublime accept for "open at line". */
function gotoSuffix(path: string, opts?: OpenInOptions): string {
  if (!opts?.line) return path;
  return `${path}:${opts.line}${opts.column ? `:${opts.column}` : ''}`;
}

/** Prefix editor args with the project dir so the file's tree loads. */
function withProject(args: string[], path: string, opts?: OpenInOptions): string[] {
  if (opts?.projectDir && opts.projectDir !== path) return [opts.projectDir, ...args];
  return args;
}

/**
 * Resolve the command + args for a given target on the current
 * platform. Returns null when the platform doesn't support the target
 * (e.g. iTerm on Linux), so the caller can return `unsupported` cleanly.
 */
function resolveCommand(target: OpenTarget, path: string, opts?: OpenInOptions): CommandSpec | null {
  const platform = process.platform;

  switch (target) {
    case 'finder':
      // Reveal/select the file in its folder rather than opening the file
      // itself (which would launch its default app).
      if (opts?.reveal) {
        if (platform === 'darwin') return { bin: 'open', args: ['-R', path] };
        if (platform === 'win32') return { bin: 'explorer', args: [`/select,${path}`] };
        if (platform === 'linux') return { bin: 'xdg-open', args: [dirname(path)] };
        return null;
      }
      if (platform === 'darwin') return { bin: 'open', args: [path] };
      if (platform === 'linux') return { bin: 'xdg-open', args: [path] };
      if (platform === 'win32') return { bin: 'explorer', args: [path] };
      return null;

    case 'terminal':
      if (platform === 'darwin') return { bin: 'open', args: ['-a', 'Terminal', path] };
      if (platform === 'linux') {
        // Try the GNOME default; users with KDE/other can fall back to
        // the IDE's built-in terminal. Probing every TE is overkill for
        // first-iteration parity.
        return { bin: 'gnome-terminal', args: ['--working-directory', path] };
      }
      if (platform === 'win32') return { bin: 'wt', args: ['-d', path] };
      return null;

    case 'iterm':
      if (platform === 'darwin') return { bin: 'open', args: ['-a', 'iTerm', path] };
      return null;

    // VS Code-family CLIs: `code [folder] --goto file:line:col`. `code` is on
    // PATH after the "Install 'code' command in PATH" Command Palette action;
    // Cursor/Antigravity are VS Code forks with the same flag surface.
    case 'vscode':
    case 'cursor':
    case 'antigravity': {
      const bin = target === 'vscode' ? 'code' : target;
      const gotoArgs = opts?.line ? ['--goto', gotoSuffix(path, opts)] : [path];
      return { bin, args: withProject(gotoArgs, path, opts) };
    }

    // Zed and Sublime accept `path:line:col` directly as a positional arg.
    case 'zed':
      return { bin: 'zed', args: withProject([gotoSuffix(path, opts)], path, opts) };

    case 'sublime':
      return { bin: 'subl', args: withProject([gotoSuffix(path, opts)], path, opts) };

    // JetBrains CLI: `webstorm [project] --line N path`.
    case 'webstorm': {
      const lineArgs = opts?.line ? ['--line', String(opts.line), path] : [path];
      return { bin: 'webstorm', args: withProject(lineArgs, path, opts) };
    }

    default:
      return null;
  }
}

/**
 * Spawn a detached GUI process and resolve once we know the outcome.
 * Sanitized env stops Flow's Next worker plumbing (TURBOPACK=1,
 * __NEXT_PRIVATE_ORIGIN, NEXT_PRIVATE_WORKER, PORT=4224, …) from leaking
 * into the spawned editor's process tree — otherwise any terminal opened
 * inside the editor inherits those and every `next dev` there thinks it's
 * a Flow worker.
 */
function spawnDetached(bin: string, args: string[]): Promise<OpenInTargetResult> {
  return new Promise((resolve) => {
    try {
      const child = spawn(bin, args, {
        detached: true,
        stdio: 'ignore',
        env: sanitizeChildEnv(),
      });

      // Spawn errors fire async (e.g. ENOENT when the binary isn't
      // installed). Resolve the promise when we know the outcome.
      let settled = false;

      child.on('error', (err: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        const reason = err.code === 'ENOENT' ? 'not_installed' : 'failed';
        resolve({ ok: false, reason, message: err.message });
      });

      // If spawn succeeds, the child carries on in the background and
      // we call it a win. unref so Node can exit even if the editor is
      // still up.
      child.unref();
      // Give error a microtask to fire before we declare success, then
      // wait briefly in case spawn rejects with ENOENT a tick later.
      setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: true });
      }, 50);
    } catch (err) {
      resolve({
        ok: false,
        reason: 'failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

export async function openInTarget(
  target: OpenTarget,
  path: string,
  opts?: OpenInOptions,
): Promise<OpenInTargetResult> {
  const cmd = resolveCommand(target, path, opts);
  if (!cmd) {
    return {
      ok: false,
      reason: 'unsupported',
      message: `${target} isn't supported on ${os.platform()}`,
    };
  }
  return spawnDetached(cmd.bin, cmd.args);
}

export interface CommandVars {
  file: string;
  line?: number;
  column?: number;
  dir?: string;
}

/**
 * Open a path with a user-defined custom command (vim/nvim/emacs/helix,
 * niche editors). The template is split on whitespace into bin + args and
 * `{file}` / `{line}` / `{column}` / `{dir}` placeholders are substituted
 * per token. Because we spawn with an args array (no shell), a `{file}`
 * that expands to a path with spaces stays a single argument. If the
 * template never mentions `{file}`, the path is appended as the last arg
 * so a bare `nvim` still opens it.
 */
export async function openWithCommand(command: string, vars: CommandVars): Promise<OpenInTargetResult> {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { ok: false, reason: 'failed', message: 'Empty command' };
  }
  const substitute = (token: string): string =>
    token
      .replace(/\{file\}/g, vars.file)
      .replace(/\{line\}/g, vars.line != null ? String(vars.line) : '')
      .replace(/\{column\}/g, vars.column != null ? String(vars.column) : '')
      .replace(/\{dir\}/g, vars.dir ?? '');
  const substituted = tokens.map(substitute);
  if (!command.includes('{file}')) substituted.push(vars.file);
  // Drop tokens that collapsed to empty (e.g. an unused bare `{line}`).
  const [bin, ...rest] = substituted;
  const args = rest.filter((a) => a.length > 0);
  return spawnDetached(bin, args);
}

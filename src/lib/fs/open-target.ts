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

interface CommandSpec {
  bin: string;
  args: string[];
}

/**
 * Resolve the command + args for a given target on the current
 * platform. Returns null when the platform doesn't support the target
 * (e.g. iTerm on Linux), so the caller can return `unsupported` cleanly.
 */
function resolveCommand(target: OpenTarget, path: string): CommandSpec | null {
  const platform = process.platform;

  switch (target) {
    case 'finder':
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

    case 'vscode':
      // `code` is on PATH after VS Code's "Install 'code' command in
      // PATH" Command Palette action; same on every platform.
      return { bin: 'code', args: [path] };

    case 'cursor':
      return { bin: 'cursor', args: [path] };

    case 'antigravity':
      return { bin: 'antigravity', args: [path] };

    case 'zed':
      return { bin: 'zed', args: [path] };

    case 'sublime':
      return { bin: 'subl', args: [path] };

    case 'webstorm':
      return { bin: 'webstorm', args: [path] };

    default:
      return null;
  }
}

export async function openInTarget(target: OpenTarget, path: string): Promise<OpenInTargetResult> {
  const cmd = resolveCommand(target, path);
  if (!cmd) {
    return {
      ok: false,
      reason: 'unsupported',
      message: `${target} isn't supported on ${os.platform()}`,
    };
  }

  return new Promise((resolve) => {
    try {
      // Sanitized env: stop Flow's Next worker plumbing
      // (TURBOPACK=1, __NEXT_PRIVATE_ORIGIN, NEXT_PRIVATE_WORKER, PORT=4224, ...)
      // from leaking into the spawned editor's process tree. Without this,
      // any terminal opened inside the editor inherits those vars and
      // every `next dev` the user runs there thinks it's a Flow worker.
      const child = spawn(cmd.bin, cmd.args, {
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

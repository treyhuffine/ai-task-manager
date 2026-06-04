import type { NextRequest } from 'next/server';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openInTarget, openWithCommand, type OpenTarget, type OpenInOptions } from '@/lib/fs/open-target';

export const runtime = 'nodejs';

/**
 * POST /api/fs/open
 *
 * Spawns a native app to open a folder/file — file manager, terminal, or a
 * code editor (optionally at a line, revealing the file, and with the
 * project root so the tree loads).
 *
 * Two guards:
 *  - **Locality:** spawning a GUI process runs it on the *host*. We only
 *    allow it for requests from the host's own loopback interface so a
 *    remote client (LAN, tunnel, relay) can't launch apps on someone
 *    else's desktop.
 *  - **Home confinement:** every path must resolve inside the user's home
 *    tree, same as the rest of `/api/fs`.
 *
 * Body: `{ path, target, line?, column?, reveal?, projectDir? }`. On success
 * the spawned process is detached and the request returns immediately;
 * failures carry a `reason` so the UI can say "VS Code isn't installed".
 */

const VALID_TARGETS: ReadonlySet<OpenTarget> = new Set([
  'finder',
  'terminal',
  'iterm',
  'vscode',
  'cursor',
  'antigravity',
  'zed',
  'sublime',
  'webstorm',
]);

/**
 * Whether the request is allowed to spawn a process on the host.
 *
 * The Bearer middleware authenticates; this *additionally* requires the
 * `x-flow-host` header, which the web client sends only when it considers
 * itself the host (loopback or a user-claimed Tailscale/LAN hostname — see
 * `useClientLocation`). Requiring a custom header instead of trusting the
 * forgeable `Host` header is deliberate: it doubles as a CSRF guard. A
 * cross-origin page can't set a custom header on a no-preflight request, and
 * a request that does set it triggers a CORS preflight the app won't approve
 * for foreign origins — so a malicious site can't turn this spawn endpoint
 * (which, with `target: 'custom'`, can launch an arbitrary local binary)
 * into drive-by code execution. A remote browser is `kind: 'remote'` and
 * never sends the header.
 */
function isHostSpawnAllowed(request: NextRequest): boolean {
  return request.headers.get('x-flow-host') === '1';
}

type ConfineResult =
  | { ok: true; resolved: string }
  | { ok: false; status: number; error: string };

/** Expand `~`, resolve symlinks, and reject anything outside the home tree. */
async function confineToHome(raw: string): Promise<ConfineResult> {
  const home = os.homedir();
  const expanded = raw.startsWith('~')
    ? path.join(home, raw.slice(1).replace(/^[/]/, ''))
    : path.resolve(raw);
  let resolved: string;
  try {
    resolved = await fs.realpath(expanded);
  } catch {
    return { ok: false, status: 404, error: 'path does not exist' };
  }
  const homeReal = await fs.realpath(home);
  if (resolved !== homeReal && !resolved.startsWith(homeReal + path.sep)) {
    return { ok: false, status: 403, error: 'path is outside home directory' };
  }
  return { ok: true, resolved };
}

export async function POST(request: NextRequest) {
  try {
    if (!isHostSpawnAllowed(request)) {
      return Response.json(
        {
          error: 'remote_forbidden',
          message: 'Opening apps is only available on the host machine.',
        },
        { status: 403 },
      );
    }

    const body: {
      path?: string;
      target?: string;
      command?: string;
      line?: number;
      column?: number;
      reveal?: boolean;
      projectDir?: string;
    } = await request.json().catch(() => ({}));

    const raw = (body.path ?? '').trim();
    const target = (body.target ?? '').trim();
    if (!raw) return Response.json({ error: 'path is required' }, { status: 400 });
    // `custom` is the user-defined-command escape hatch; every other target
    // must be a known app.
    if (target !== 'custom' && !VALID_TARGETS.has(target as OpenTarget)) {
      return Response.json({ error: 'invalid target' }, { status: 400 });
    }

    const pathRes = await confineToHome(raw);
    if (!pathRes.ok) return Response.json({ error: pathRes.error }, { status: pathRes.status });

    let projectDir: string | undefined;
    if (body.projectDir && body.projectDir.trim()) {
      const projRes = await confineToHome(body.projectDir.trim());
      if (!projRes.ok) {
        return Response.json({ error: `projectDir: ${projRes.error}` }, { status: projRes.status });
      }
      projectDir = projRes.resolved;
    }

    const opts: OpenInOptions = {
      line: Number.isInteger(body.line) && body.line! > 0 ? body.line : undefined,
      column: Number.isInteger(body.column) && body.column! > 0 ? body.column : undefined,
      reveal: body.reveal === true,
      projectDir,
    };

    const result =
      target === 'custom'
        ? await (async () => {
            const command = (body.command ?? '').trim();
            if (!command) return null;
            return openWithCommand(command, {
              file: pathRes.resolved,
              line: opts.line,
              column: opts.column,
              dir: projectDir,
            });
          })()
        : await openInTarget(target as OpenTarget, pathRes.resolved, opts);

    if (result === null) {
      return Response.json({ error: 'command is required for custom target' }, { status: 400 });
    }
    if (!result.ok) {
      // 422 = well-formed request we couldn't fulfill (app missing, platform
      // unsupported). The client can dim the menu item next time.
      return Response.json(result, { status: 422 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/fs/open]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

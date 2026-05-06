import type { NextRequest } from 'next/server';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openInTarget, type OpenTarget } from '@/lib/fs/open-target';

/**
 * POST /api/fs/open
 *
 * Spawns a native app to open the given folder. Same homedir
 * confinement as the rest of `/api/fs` — we never touch paths outside
 * the user's home tree.
 *
 * Body: `{ path: string, target: OpenTarget }`. On success the spawned
 * process is detached and the request returns immediately. Failures
 * carry a `reason` so the UI can show "VS Code isn't installed" rather
 * than a generic 500.
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

export async function POST(request: NextRequest) {
  try {
    const body: { path?: string; target?: string } = await request.json().catch(() => ({}));
    const raw = (body.path ?? '').trim();
    const target = body.target as OpenTarget | undefined;
    if (!raw) return Response.json({ error: 'path is required' }, { status: 400 });
    if (!target || !VALID_TARGETS.has(target)) {
      return Response.json({ error: 'invalid target' }, { status: 400 });
    }

    const home = os.homedir();
    const expanded = raw.startsWith('~')
      ? path.join(home, raw.slice(1).replace(/^[/]/, ''))
      : path.resolve(raw);

    let resolved: string;
    try {
      resolved = await fs.realpath(expanded);
    } catch {
      return Response.json({ error: 'path does not exist' }, { status: 404 });
    }

    const homeReal = await fs.realpath(home);
    if (resolved !== homeReal && !resolved.startsWith(homeReal + path.sep)) {
      return Response.json({ error: 'path is outside home directory' }, { status: 403 });
    }

    const result = await openInTarget(target, resolved);
    if (!result.ok) {
      // 422 = the request is well-formed but we couldn't fulfill it
      // (app missing, platform unsupported). The client will know the
      // app isn't installed and can dim the menu item next time.
      return Response.json(result, { status: 422 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/fs/open]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

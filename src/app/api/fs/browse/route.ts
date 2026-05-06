import type { NextRequest } from 'next/server';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Directory autocomplete for the workspace folder picker.
 *
 * Resolves the requested path (expanding `~`), then realpaths it. Refuses
 * to list anything outside `homedir()` so the picker can't be coerced into
 * exposing arbitrary filesystem state.
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const raw = params.get('path') ?? '~';
    const home = os.homedir();
    const expanded = raw.startsWith('~')
      ? path.join(home, raw.slice(1).replace(/^[/]/, ''))
      : path.resolve(raw);

    let resolved: string;
    try {
      resolved = await fs.realpath(expanded);
    } catch {
      // Path doesn't exist — return empty so the UI can still show the typed value.
      return Response.json({ path: expanded, entries: [], parent: path.dirname(expanded) });
    }

    const homeReal = await fs.realpath(home);
    if (resolved !== homeReal && !resolved.startsWith(homeReal + path.sep)) {
      return Response.json({ error: 'Path is outside home directory' }, { status: 403 });
    }

    const dirents = await fs.readdir(resolved, { withFileTypes: true });
    const entries = dirents
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => ({ name: d.name, path: path.join(resolved, d.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return Response.json({
      path: resolved,
      parent: resolved === homeReal ? null : path.dirname(resolved),
      entries,
    });
  } catch (err) {
    console.error('[GET /api/fs/browse]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

import type { NextRequest } from 'next/server';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Create a single subdirectory under the home-dir sandbox.
 *
 * Body: `{ parent: string, name: string }` — `parent` may use `~` and is
 * resolved+realpathed; `name` must be a single path segment (no slashes,
 * no `..`). The resulting path is also sandboxed under homedir.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      parent?: string;
      name?: string;
    };
    const parentRaw = body.parent;
    const name = body.name?.trim();

    if (!parentRaw || !name) {
      return Response.json({ error: 'parent and name are required' }, { status: 400 });
    }

    // Single segment only — no traversal, no nested creation, no hidden
    // leading dots (we want a real folder name, not a dotfile dir).
    if (/[\\/]/.test(name) || name === '.' || name === '..' || name.startsWith('.')) {
      return Response.json({ error: 'Invalid folder name' }, { status: 400 });
    }

    const home = os.homedir();
    const expanded = parentRaw.startsWith('~')
      ? path.join(home, parentRaw.slice(1).replace(/^[/]/, ''))
      : path.resolve(parentRaw);

    let resolvedParent: string;
    try {
      resolvedParent = await fs.realpath(expanded);
    } catch {
      return Response.json({ error: 'Parent does not exist' }, { status: 404 });
    }

    const homeReal = await fs.realpath(home);
    if (resolvedParent !== homeReal && !resolvedParent.startsWith(homeReal + path.sep)) {
      return Response.json({ error: 'Path is outside home directory' }, { status: 403 });
    }

    const target = path.join(resolvedParent, name);
    try {
      await fs.mkdir(target);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        return Response.json({ error: 'A folder with that name already exists' }, { status: 409 });
      }
      if (code === 'EACCES' || code === 'EPERM') {
        return Response.json({ error: 'Permission denied' }, { status: 403 });
      }
      throw err;
    }

    return Response.json({ path: target });
  } catch (err) {
    console.error('[POST /api/fs/mkdir]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

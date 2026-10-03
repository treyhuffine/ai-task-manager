import { reply, type OperationContext } from '@/lib/server/operation';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z as rpcZ } from 'zod/v4';

/**
 * Create a single subdirectory under the home-dir sandbox.
 *
 * Body: `{ parent: string, name: string }` — `parent` may use `~` and is
 * resolved+realpathed; `name` must be a single path segment (no slashes,
 * no `..`). The resulting path is also sandboxed under homedir.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const body = (rpcInput.body) as {
      parent?: string;
      name?: string;
    };
    const parentRaw = body.parent;
    const name = body.name?.trim();

    if (!parentRaw || !name) {
      return reply({ error: 'parent and name are required' }, { status: 400 });
    }

    // Single segment only — no traversal, no nested creation, no hidden
    // leading dots (we want a real folder name, not a dotfile dir).
    if (/[\\/]/.test(name) || name === '.' || name === '..' || name.startsWith('.')) {
      return reply({ error: 'Invalid folder name' }, { status: 400 });
    }

    const home = os.homedir();
    const expanded = parentRaw.startsWith('~')
      ? path.join(home, parentRaw.slice(1).replace(/^[/]/, ''))
      : path.resolve(parentRaw);

    let resolvedParent: string;
    try {
      resolvedParent = await fs.realpath(expanded);
    } catch {
      return reply({ error: 'Parent does not exist' }, { status: 404 });
    }

    const homeReal = await fs.realpath(home);
    if (resolvedParent !== homeReal && !resolvedParent.startsWith(homeReal + path.sep)) {
      return reply({ error: 'Path is outside home directory' }, { status: 403 });
    }

    const target = path.join(resolvedParent, name);
    try {
      await fs.mkdir(target);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        return reply({ error: 'A folder with that name already exists' }, { status: 409 });
      }
      if (code === 'EACCES' || code === 'EPERM') {
        return reply({ error: 'Permission denied' }, { status: 403 });
      }
      throw err;
    }

    return reply({ path: target });
  } catch (err) {
    console.error('[POST /api/fs/mkdir]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ "parent": rpcZ.string().optional(), "name": rpcZ.string().optional() }).strict().default({}) }).strict();

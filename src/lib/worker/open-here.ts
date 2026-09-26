/**
 * Opening a folder here in an app, for the home (P3.5, spec §3.3): an
 * execution's worktree this computer prepared, for the placement it holds,
 * or an agent's folder from this computer's setup files. The path is
 * resolved inside that folder, symlinks included, and only a known app
 * opens it. Never a command, and never a path the home names.
 */

import fs from 'node:fs';
import path from 'node:path';
import { openInTarget, type OpenTarget } from '@/lib/fs/open-target';
import { listInstalledApps } from '@/lib/fs/installed-apps';
import type { OpenHereRequest } from '@/lib/workers/protocol';
import type { ReadAnswer } from '@/lib/workspaces/execution-reads';
import type { CommandJournal } from './command-journal';

const TARGETS: ReadonlySet<OpenTarget> = new Set([
  'finder', 'terminal', 'iterm', 'vscode', 'cursor', 'antigravity', 'zed', 'sublime', 'webstorm',
]);

export interface OpenHereOptions {
  journal: Pick<CommandJournal, 'preparedWorktree' | 'released' | 'highestGeneration'>;
  agentFolder: (agentId: string) => string | null;
  /** Opens it. The real one spawns the app. */
  open?: typeof openInTarget;
}

export async function openHere(request: OpenHereRequest, options: OpenHereOptions): Promise<ReadAnswer> {
  if (request.op === 'apps') return { status: 200, body: await listInstalledApps() };
  if (!TARGETS.has(request.target)) return { status: 400, body: { error: 'invalid target' } };

  let folder: string | null;
  if (request.folder.kind === 'agent') {
    folder = options.agentFolder(request.folder.agentId);
    if (!folder) return { status: 409, body: { error: 'not_set_up', message: "This agent isn't set up on this computer." } };
  } else {
    const { executionId, generation } = request.folder;
    const newest = options.journal.highestGeneration(executionId);
    if (options.journal.released(executionId, generation) || (newest !== null && generation < newest)) {
      return { status: 409, body: { error: 'moved', message: 'This execution no longer runs on this computer.' } };
    }
    folder = options.journal.preparedWorktree(executionId);
    if (!folder) return { status: 409, body: { error: 'not_prepared', message: "This execution isn't set up on this computer yet." } };
  }

  const inside = resolveInside(folder, request.path);
  if (!inside) return { status: 400, body: { error: 'invalid_path', message: `Not inside the folder: ${request.path}` } };
  const result = await (options.open ?? openInTarget)(request.target, inside, {
    line: request.line,
    column: request.column,
    reveal: request.reveal,
    projectDir: folder,
  });
  return { status: 200, body: result };
}

/** The real path of `rel` inside `folder`, or null when it's elsewhere or missing. */
function resolveInside(folder: string, rel: string | null): string | null {
  try {
    const root = fs.realpathSync(folder);
    if (!rel) return root;
    if (path.isAbsolute(rel) || rel.includes('\0')) return null;
    const real = fs.realpathSync(path.join(root, rel));
    return real === root || real.startsWith(root + path.sep) ? real : null;
  } catch {
    return null;
  }
}

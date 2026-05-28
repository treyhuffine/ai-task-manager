/**
 * Per-clone state file for `flow takeover` / `flow resume`.
 *
 * Lives at `<clone-path>/.flow-takeover.json`. Holds just enough for
 * `flow resume` to find its way back to the host: the URL it called,
 * the token it was issued, the branch it checked out. Deleted on
 * successful resume so the clone dir is clean for next time.
 *
 * Per-clone is the right scope: each workspace has its own clone, so
 * each clone has its own in-flight takeover (or none). Multiple
 * concurrent takeovers across different workspaces are independent.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getClonesDir } from '@/lib/config/paths';

export interface TakeoverState {
  host: string;
  token: string;
  sessionId: string;
  workspaceId: string;
  workspaceName: string;
  branch: string;
  startedAt: string;
}

const STATE_FILENAME = '.flow-takeover.json';

export function stateFilePath(clonePath: string): string {
  return path.join(clonePath, STATE_FILENAME);
}

export function writeState(clonePath: string, state: TakeoverState): void {
  fs.writeFileSync(stateFilePath(clonePath), JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
}

export function readState(clonePath: string): TakeoverState | null {
  try {
    const raw = fs.readFileSync(stateFilePath(clonePath), 'utf8');
    const parsed = JSON.parse(raw) as Partial<TakeoverState>;
    if (
      typeof parsed.host !== 'string' ||
      typeof parsed.token !== 'string' ||
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.workspaceId !== 'string' ||
      typeof parsed.branch !== 'string' ||
      typeof parsed.startedAt !== 'string'
    ) {
      return null;
    }
    return {
      host: parsed.host,
      token: parsed.token,
      sessionId: parsed.sessionId,
      workspaceId: parsed.workspaceId,
      workspaceName: parsed.workspaceName ?? parsed.workspaceId,
      branch: parsed.branch,
      startedAt: parsed.startedAt,
    };
  } catch {
    return null;
  }
}

export function clearState(clonePath: string): void {
  try {
    fs.unlinkSync(stateFilePath(clonePath));
  } catch {
    // Already gone, fine.
  }
}

export interface ActiveTakeover {
  clonePath: string;
  state: TakeoverState;
}

/** Scan every clone dir for an active takeover. Used by `flow resume`
 *  when called with no args and by `flow takeover --list`. */
export function findActiveTakeovers(): ActiveTakeover[] {
  const root = getClonesDir();
  if (!fs.existsSync(root)) return [];

  const out: ActiveTakeover[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const clonePath = path.join(root, entry.name);
    const state = readState(clonePath);
    if (state) out.push({ clonePath, state });
  }
  // Most recent first.
  out.sort((a, b) => b.state.startedAt.localeCompare(a.state.startedAt));
  return out;
}

/** Resolve a clone dir for a workspaceId. Doesn't create it. */
export function cloneDirFor(workspaceId: string): string {
  return path.join(getClonesDir(), workspaceId);
}

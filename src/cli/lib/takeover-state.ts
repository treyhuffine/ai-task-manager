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
  session_id: string;
  workspace_id: string;
  workspace_name: string;
  branch: string;
  started_at: string;
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
      typeof parsed.session_id !== 'string' ||
      typeof parsed.workspace_id !== 'string' ||
      typeof parsed.branch !== 'string' ||
      typeof parsed.started_at !== 'string'
    ) {
      return null;
    }
    return {
      host: parsed.host,
      token: parsed.token,
      session_id: parsed.session_id,
      workspace_id: parsed.workspace_id,
      workspace_name: parsed.workspace_name ?? parsed.workspace_id,
      branch: parsed.branch,
      started_at: parsed.started_at,
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
  out.sort((a, b) => b.state.started_at.localeCompare(a.state.started_at));
  return out;
}

/** Resolve a clone dir for a workspace_id. Doesn't create it. */
export function cloneDirFor(workspaceId: string): string {
  return path.join(getClonesDir(), workspaceId);
}

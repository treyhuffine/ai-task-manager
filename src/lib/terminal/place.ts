import { operationResponse } from '@/lib/server/operation';
import { createTerminalResult, deleteTerminalResult, getTerminalResult, listTerminalsResult, terminalInputResult, terminalResizeResult } from './operations';
/**
 * Where a terminal runs (docs/homes-build.md, P3.5, spec §5.6), and the
 * route handlers that go there. An execution's shells run on the device
 * the execution runs on, in its working folder. An agent's own shells run on
 * the device the agent lives on, in its folder there. The home runs its own
 * in process; another device's are reached through its worker
 * (`remote.ts`). Resolved on every operation, so a terminal is only ever
 * reached through the placement that holds it now.
 *
 * An execution elsewhere never falls back to a shell at home: not in the
 * agent's folder here, not anywhere.
 */

import {
	chatPlacement,
	getChatSessionWithExecution,
	getDevice,
	getHome,
	getWorkspace,
	touchSessionActivity,
} from '@/lib/db/queries';
import { agentDeviceFor } from '@/lib/setups/run-on';
import {
	terminalStreamResponse
} from './http';
import {
	isExistingDir,
	sessionTerminalOwner,
	terminalOwnerId,
	workspaceTerminalCwd,
	workspaceTerminalOwner,
	type TerminalCwd,
	type TerminalOwner,
} from './owner';
import { remoteTerminalStream, type RemoteTerminalPlace } from './remote';

/** Where the shell runs, as every terminal descriptor says it. */
export interface TerminalLocation {
  deviceName: string | null;
  isHome: boolean;
}

export type TerminalPlace =
  | { at: 'home'; owner: TerminalOwner; cwd: () => TerminalCwd; location: TerminalLocation }
  | ({ at: 'elsewhere'; location: TerminalLocation; refuseCreate?: string } & RemoteTerminalPlace)
  | { at: 'nowhere'; error: string; status: number };

function homeLocation(): TerminalLocation {
  const host = getHome()?.hostDeviceId;
  return { deviceName: (host && getDevice(host)?.name) || null, isHome: true };
}

/** An execution's shells: on its device, in its working folder. */
export function sessionTerminalPlace(sessionId: string): TerminalPlace {
  const session = getChatSessionWithExecution(sessionId);
  if (!session) return { at: 'nowhere', error: 'Session not found', status: 404 };
  const placement = chatPlacement(sessionId);
  if (placement && !placement.isHome) {
    const deviceName = getDevice(placement.deviceId)?.name ?? 'Its device';
    if (!placement.executionId) {
      return { at: 'nowhere', error: `This chat runs on ${deviceName}. Terminals open in its executions.`, status: 409 };
    }
    return {
      at: 'elsewhere',
      deviceId: placement.deviceId,
      deviceName,
      scope: { kind: 'execution', executionId: placement.executionId, generation: placement.generation ?? 0 },
      location: { deviceName, isHome: false },
    };
  }
  return { at: 'home', owner: sessionTerminalOwner(sessionId), cwd: () => homeSessionCwd(sessionId), location: homeLocation() };
}

/**
 * Where a new shell for an execution at home starts: its worktree, or for a
 * non-git agent its folder. A git execution never gets the source checkout,
 * the PTY's folder being fixed for its lifetime.
 */
function homeSessionCwd(sessionId: string): TerminalCwd {
  const session = getChatSessionWithExecution(sessionId);
  if (!session) return { ok: false, error: 'Session not found', status: 404 };
  const ownerId = terminalOwnerId(session);
  if (isExistingDir(session.worktreePath)) return { ok: true, cwd: session.worktreePath, ownerId };
  const ws = session.workspaceId ? getWorkspace(session.workspaceId) : undefined;
  if (ws?.isGit) {
    if (session.worktreePath) {
      return { ok: false, error: `Worktree directory does not exist: ${session.worktreePath}`, status: 409 };
    }
    return { ok: false, error: 'Worktree is still being set up for this session', status: 409 };
  }
  if (isExistingDir(ws?.cwd)) return { ok: true, cwd: ws.cwd, ownerId };
  return { ok: false, error: 'No worktree or workspace cwd for this session', status: 409 };
}

/** An agent's own shells: on the device it lives on, in its folder there. */
export function agentTerminalPlace(workspaceId: string): TerminalPlace {
  const ws = getWorkspace(workspaceId);
  if (!ws) return { at: 'nowhere', error: 'Workspace not found', status: 404 };
  const deviceId = agentDeviceFor(workspaceId);
  if (deviceId) {
    const deviceName = getDevice(deviceId)?.name ?? 'Its device';
    return {
      at: 'elsewhere',
      deviceId,
      deviceName,
      scope: { kind: 'agent', agentId: workspaceId },
      location: { deviceName, isHome: false },
      // Archiving reaps an agent's shells, and gives it no new ones.
      ...(ws.status === 'archived' ? { refuseCreate: 'This agent is archived' } : {}),
    };
  }
  return { at: 'home', owner: workspaceTerminalOwner(workspaceId), cwd: () => workspaceTerminalCwd(workspaceId), location: homeLocation() };
}

/** Compatibility adapters for worker and public HTTP callers. */
export async function listTerminalsAt(place: TerminalPlace) { return operationResponse(await listTerminalsResult(place)); }
export async function createTerminalAt(request: Request, place: TerminalPlace, logTag: string) {
  return operationResponse(await createTerminalResult(await request.json().catch(() => ({})), place, logTag));
}
export async function getTerminalAt(place: TerminalPlace, terminalId: string) { return operationResponse(await getTerminalResult(place, terminalId)); }
export async function deleteTerminalAt(place: TerminalPlace, terminalId: string) { return operationResponse(await deleteTerminalResult(place, terminalId)); }
export async function terminalInputAt(request: Request, place: TerminalPlace, terminalId: string, onInput?: () => void) {
  return operationResponse(await terminalInputResult(await request.json().catch(() => ({})), place, terminalId, onInput));
}
export async function terminalResizeAt(request: Request, place: TerminalPlace, terminalId: string) {
  return operationResponse(await terminalResizeResult(await request.json().catch(() => ({})), place, terminalId));
}

export function terminalStreamAt(request: Request, resolve: () => TerminalPlace, terminalId: string): Response {
  const place = resolve();
  if (place.at === 'elsewhere') return remoteTerminalStream(request, place, terminalId);
  return terminalStreamResponse(
    request,
    () => (place.at === 'home' ? place.owner : { ok: false, error: place.error, status: place.status }),
    terminalId,
  );
}

/** Keystrokes into an execution's shell count as activity on it, wherever it runs. */
export function touchTerminalActivity(sessionId: string): void {
  touchSessionActivity(sessionId, 'terminal', { throttle: true });
}

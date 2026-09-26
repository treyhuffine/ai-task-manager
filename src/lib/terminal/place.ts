/**
 * Where a terminal runs (docs/homes-build.md, P3.5, spec §5.6), and the
 * route handlers that go there. An execution's shells run on the computer
 * the execution runs on, in its working folder. An agent's own shells run on
 * the computer the agent lives on, in its folder there. The home runs its own
 * in process; another computer's are reached through its worker
 * (`remote.ts`). Resolved on every operation, so a terminal is only ever
 * reached through the placement that holds it now.
 *
 * An execution elsewhere never falls back to a shell at home: not in the
 * agent's folder here, not anywhere.
 */

import {
  chatPlacement,
  getChatSessionWithExecution,
  getComputer,
  getHome,
  getWorkspace,
  touchSessionActivity,
} from '@/lib/db/queries';
import { agentComputerFor } from '@/lib/setups/run-on';
import type { TerminalRequest } from '@/lib/workers/protocol';
import {
  createTerminalResponse,
  deleteTerminalResponse,
  getTerminalResponse,
  listTerminalsResponse,
  terminalInputResponse,
  terminalResizeResponse,
  terminalStreamResponse,
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
import { askTerminal, remoteTerminalStream, type RemoteTerminalPlace } from './remote';

/** Where the shell runs, as every terminal descriptor says it. */
export interface TerminalLocation {
  computerName: string | null;
  isHome: boolean;
}

export type TerminalPlace =
  | { at: 'home'; owner: TerminalOwner; cwd: () => TerminalCwd; location: TerminalLocation }
  | ({ at: 'elsewhere'; location: TerminalLocation; refuseCreate?: string } & RemoteTerminalPlace)
  | { at: 'nowhere'; error: string; status: number };

function homeLocation(): TerminalLocation {
  const host = getHome()?.hostComputerId;
  return { computerName: (host && getComputer(host)?.name) || null, isHome: true };
}

/** An execution's shells: on its computer, in its working folder. */
export function sessionTerminalPlace(sessionId: string): TerminalPlace {
  const session = getChatSessionWithExecution(sessionId);
  if (!session) return { at: 'nowhere', error: 'Session not found', status: 404 };
  const placement = chatPlacement(sessionId);
  if (placement && !placement.isHome) {
    const computerName = getComputer(placement.computerId)?.name ?? 'Its computer';
    if (!placement.executionId) {
      return { at: 'nowhere', error: `This chat runs on ${computerName}. Terminals open in its executions.`, status: 409 };
    }
    return {
      at: 'elsewhere',
      computerId: placement.computerId,
      computerName,
      scope: { kind: 'execution', executionId: placement.executionId, generation: placement.generation ?? 0 },
      location: { computerName, isHome: false },
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

/** An agent's own shells: on the computer it lives on, in its folder there. */
export function agentTerminalPlace(workspaceId: string): TerminalPlace {
  const ws = getWorkspace(workspaceId);
  if (!ws) return { at: 'nowhere', error: 'Workspace not found', status: 404 };
  const computerId = agentComputerFor(workspaceId);
  if (computerId) {
    const computerName = getComputer(computerId)?.name ?? 'Its computer';
    return {
      at: 'elsewhere',
      computerId,
      computerName,
      scope: { kind: 'agent', agentId: workspaceId },
      location: { computerName, isHome: false },
      // Archiving reaps an agent's shells, and gives it no new ones.
      ...(ws.status === 'archived' ? { refuseCreate: 'This agent is archived' } : {}),
    };
  }
  return { at: 'home', owner: workspaceTerminalOwner(workspaceId), cwd: () => workspaceTerminalCwd(workspaceId), location: homeLocation() };
}

function refuse(place: { error: string; status: number }): Response {
  return Response.json({ error: place.error }, { status: place.status });
}

/** A descriptor, or a list of them, with where the shell runs. */
function located(body: unknown, location: TerminalLocation): unknown {
  const add = (d: unknown) => (d && typeof d === 'object' ? { ...d, ...location } : d);
  return Array.isArray(body) ? body.map(add) : add(body);
}

async function relay(place: RemoteTerminalPlace & { location: TerminalLocation }, request: TerminalRequest, locate = false): Promise<Response> {
  const answer = await askTerminal(place, request);
  const ok = answer.status >= 200 && answer.status < 300;
  return Response.json(ok && locate ? located(answer.body, place.location) : answer.body, { status: answer.status });
}

async function withLocation(res: Response, location: TerminalLocation): Promise<Response> {
  if (!res.ok) return res;
  return Response.json(located(await res.json(), location), { status: res.status });
}

async function dims(request: Request): Promise<{ cols: number; rows: number } | null> {
  const body = (await request.json().catch(() => null)) as { cols?: number; rows?: number } | null;
  if (!body || !Number.isFinite(body.cols) || !Number.isFinite(body.rows) || body.cols! < 1 || body.rows! < 1) return null;
  return { cols: Math.floor(body.cols!), rows: Math.floor(body.rows!) };
}

export async function listTerminalsAt(place: TerminalPlace): Promise<Response> {
  if (place.at === 'nowhere') return refuse(place);
  if (place.at === 'elsewhere') return relay(place, { op: 'list', scope: place.scope }, true);
  return withLocation(listTerminalsResponse(place.owner), place.location);
}

export async function createTerminalAt(request: Request, place: TerminalPlace, logTag: string): Promise<Response> {
  if (place.at === 'nowhere') return refuse(place);
  if (place.at === 'elsewhere') {
    if (place.refuseCreate) return Response.json({ error: place.refuseCreate }, { status: 409 });
    const size = (await dims(request)) ?? { cols: 80, rows: 24 };
    return relay(place, { op: 'create', scope: place.scope, ...size }, true);
  }
  return withLocation(await createTerminalResponse(request, place.cwd(), logTag), place.location);
}

export async function getTerminalAt(place: TerminalPlace, terminalId: string): Promise<Response> {
  if (place.at === 'nowhere') return refuse(place);
  if (place.at === 'elsewhere') return relay(place, { op: 'get', scope: place.scope, terminalId }, true);
  return withLocation(getTerminalResponse(place.owner, terminalId), place.location);
}

export async function deleteTerminalAt(place: TerminalPlace, terminalId: string): Promise<Response> {
  if (place.at === 'nowhere') return refuse(place);
  if (place.at === 'elsewhere') return relay(place, { op: 'close', scope: place.scope, terminalId });
  return deleteTerminalResponse(place.owner, terminalId);
}

/**
 * Keystrokes. To another computer they go as they're typed or not at all:
 * a computer that isn't connected refuses them, and they aren't kept to
 * send later (spec §5.6).
 */
export async function terminalInputAt(
  request: Request,
  place: TerminalPlace,
  terminalId: string,
  onInput?: () => void,
): Promise<Response> {
  if (place.at === 'nowhere') return refuse(place);
  if (place.at === 'home') return terminalInputResponse(request, place.owner, terminalId, onInput);
  const body = (await request.json().catch(() => null)) as { data?: unknown } | null;
  if (!body || typeof body.data !== 'string') return Response.json({ error: 'data must be a string' }, { status: 400 });
  const res = await relay(place, { op: 'input', scope: place.scope, terminalId, data: body.data });
  if (res.ok) onInput?.();
  return res;
}

export async function terminalResizeAt(request: Request, place: TerminalPlace, terminalId: string): Promise<Response> {
  if (place.at === 'nowhere') return refuse(place);
  if (place.at === 'home') return terminalResizeResponse(request, place.owner, terminalId);
  const size = await dims(request);
  if (!size) return Response.json({ error: 'cols and rows must be positive numbers' }, { status: 400 });
  return relay(place, { op: 'resize', scope: place.scope, terminalId, ...size });
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

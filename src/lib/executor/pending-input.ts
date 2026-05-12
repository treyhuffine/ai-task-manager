/**
 * Pending-input store — the seam between agentex's `onUserInputRequest`
 * callback and the UI.
 *
 * When Claude requests a tool permission (via `--permission-prompt-tool
 * stdio`) or invokes `AskUserQuestion`, agentex calls
 * `onUserInputRequest` and waits for a response. We can't return
 * synchronously from a route handler, so the callback registers a
 * pending entry, persists a `permission_request` / `question_request`
 * row to `chat_events`, and awaits a resolver promise. The UI polls
 * `/api/sessions/[id]/pending-input`, posts the answer, and the
 * resolver fires — the agentex callback returns and Claude proceeds.
 *
 * Module-scope state (stashed on `globalThis`) is intentional. The
 * `runningSessions` map in `adapter.ts` follows the same pattern so
 * Next.js's per-route module re-evaluation doesn't fragment the state.
 *
 * RequestId is the agentex `toolUseId` directly. Globally unique across
 * Claude sessions. We never collide; the UI uses the same id to resolve.
 */

import type { UserInputRequest, UserInputResponse } from '@agentex/agent';
import { parseAskUserQuestion, type AskUserQuestion } from '@agentex/agent';
import { publishPendingInput } from '@/lib/realtime/bus';

export type PendingInputKind = 'permission' | 'question';

export interface PendingPermission {
  kind: 'permission';
  requestId: string;
  sessionId: string;
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  title: string | null;
  description: string | null;
  createdAt: string;
}

export interface PendingQuestion {
  kind: 'question';
  requestId: string;
  sessionId: string;
  toolUseId: string;
  questions: AskUserQuestion[];
  /**
   * Original tool input from agentex. We need to spread this back into
   * `updatedInput` when answering so any non-`questions` fields Claude
   * may add in future versions are preserved. See agentex's
   * `parseAskUserQuestion` example for the contract.
   */
  originalInput: Record<string, unknown>;
  createdAt: string;
}

export type PendingInput = PendingPermission | PendingQuestion;

interface PendingEntry {
  pending: PendingInput;
  resolve: (response: UserInputResponse) => void;
  reject: (err: Error) => void;
}

interface PendingState {
  /** requestId → entry */
  byId: Map<string, PendingEntry>;
  /** sessionId → set of requestIds (fast scan when listing) */
  bySession: Map<string, Set<string>>;
}

const STATE_KEY = Symbol.for('@flow/pending-input-state');
const globalRef = globalThis as unknown as { [STATE_KEY]?: PendingState };

if (!globalRef[STATE_KEY]) {
  globalRef[STATE_KEY] = { byId: new Map(), bySession: new Map() };
}

const state = globalRef[STATE_KEY]!;

// ─── Public API ───────────────────────────────────────────────

/** Convert a UserInputRequest into a PendingInput. Returns null for unknown shapes. */
export function classifyRequest(
  sessionId: string,
  req: UserInputRequest,
): PendingInput {
  const questions = parseAskUserQuestion(req);
  if (questions) {
    return {
      kind: 'question',
      requestId: req.toolUseId,
      sessionId,
      toolUseId: req.toolUseId,
      questions,
      originalInput: req.input,
      createdAt: new Date().toISOString(),
    };
  }

  return {
    kind: 'permission',
    requestId: req.toolUseId,
    sessionId,
    toolUseId: req.toolUseId,
    toolName: req.toolName,
    input: req.input,
    title: req.title ?? null,
    description: req.description ?? null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Register a pending request and return a promise that resolves when the
 * UI answers. The caller (adapter.ts) hands the resolved response back to
 * agentex which returns it to Claude.
 */
export function register(pending: PendingInput): Promise<UserInputResponse> {
  return new Promise<UserInputResponse>((resolve, reject) => {
    state.byId.set(pending.requestId, { pending, resolve, reject });
    let set = state.bySession.get(pending.sessionId);
    if (!set) {
      set = new Set();
      state.bySession.set(pending.sessionId, set);
    }
    set.add(pending.requestId);
    notify(pending.sessionId);
  });
}

/** Resolve a pending request. Returns false if the requestId is not pending. */
export function resolveRequest(
  requestId: string,
  response: UserInputResponse,
): { ok: true; pending: PendingInput } | { ok: false } {
  const entry = state.byId.get(requestId);
  if (!entry) return { ok: false };
  const sessionId = entry.pending.sessionId;
  remove(requestId);
  notify(sessionId);
  entry.resolve(response);
  return { ok: true, pending: entry.pending };
}

/**
 * Reject every pending request for a session. Used on interrupt/close so
 * the agentex callback completes (with deny) instead of hanging
 * indefinitely. Claude treats deny as a normal tool rejection.
 */
export function rejectAllForSession(sessionId: string, reason: string): void {
  const ids = state.bySession.get(sessionId);
  if (!ids || ids.size === 0) return;
  for (const id of [...ids]) {
    const entry = state.byId.get(id);
    if (!entry) continue;
    remove(id);
    // Resolve with deny rather than reject so agentex's await doesn't
    // throw — we want a clean tool rejection in the transcript, not a
    // crash.
    entry.resolve({ allow: false, message: reason });
  }
  // Single notify after the bulk-remove so subscribers see the cleared
  // list once, not once per cancelled request.
  notify(sessionId);
}

export function listForSession(sessionId: string): PendingInput[] {
  const ids = state.bySession.get(sessionId);
  if (!ids) return [];
  const out: PendingInput[] = [];
  for (const id of ids) {
    const entry = state.byId.get(id);
    if (entry) out.push(entry.pending);
  }
  // Stable order: oldest first.
  out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return out;
}

export function getPending(requestId: string): PendingInput | null {
  return state.byId.get(requestId)?.pending ?? null;
}

/** Test helper. */
export function _resetPendingInput(): void {
  state.byId.clear();
  state.bySession.clear();
}

// ─── Internal ─────────────────────────────────────────────────

function notify(sessionId: string): void {
  publishPendingInput(sessionId, listForSession(sessionId));
}

function remove(requestId: string): void {
  const entry = state.byId.get(requestId);
  if (!entry) return;
  state.byId.delete(requestId);
  const set = state.bySession.get(entry.pending.sessionId);
  if (set) {
    set.delete(requestId);
    if (set.size === 0) state.bySession.delete(entry.pending.sessionId);
  }
}

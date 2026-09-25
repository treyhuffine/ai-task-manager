/**
 * The home's mirror of what's live on connected computers
 * (docs/homes-build.md, P2.1 "Live state" and P2.4): which chats are
 * running there, their pending prompts, background tasks and command
 * inventory. Kept from the signals each worker reports, and replaced by the
 * snapshot in each heartbeat, so a home that restarted or missed a signal
 * catches up within one heartbeat.
 *
 * In memory, like the local runner's own state. The live-state facade reads
 * this beside the local runner. Imports nothing heavy.
 */

import type { RuntimeCommandInventory } from '@agentex/agent';
import type { PendingInput } from '@/lib/runner/pending';
import type { RunnerSignal } from '@/lib/runner/types';

export interface RemoteChatState {
  computerId: string;
  running: boolean;
  pending: PendingInput[];
  backgroundTaskIds: string[];
  inventory: RuntimeCommandInventory | null;
}

/** What a worker reports as live, in its heartbeat. */
export interface WorkerLiveSnapshot {
  running: string[];
  pending: PendingInput[];
  backgroundTasks: Record<string, string[]>;
}

const MIRROR_KEY = Symbol.for('@ri/remote-live');
const globalRef = globalThis as unknown as { [MIRROR_KEY]?: Map<string, RemoteChatState> };
if (!globalRef[MIRROR_KEY]) globalRef[MIRROR_KEY] = new Map();
const mirror = globalRef[MIRROR_KEY]!;

function chatState(chatSessionId: string, computerId: string): RemoteChatState {
  let state = mirror.get(chatSessionId);
  if (!state || state.computerId !== computerId) {
    state = { computerId, running: false, pending: [], backgroundTaskIds: [], inventory: null };
    mirror.set(chatSessionId, state);
  }
  return state;
}

/** Fold one signal a worker reported for one of its chats. */
export function mirrorSignal(computerId: string, chatSessionId: string, signal: RunnerSignal): void {
  const state = chatState(chatSessionId, computerId);
  switch (signal.type) {
    case 'running':
      state.running = signal.running;
      return;
    case 'background_tasks':
      state.backgroundTaskIds = signal.taskIds;
      return;
    case 'inventory':
      state.inventory = signal.inventory;
      return;
    case 'pending_input':
      if (!state.pending.some((p) => p.requestId === signal.pending.requestId)) state.pending = [...state.pending, signal.pending];
      return;
    case 'pending_resolved':
      state.pending = state.pending.filter((p) => p.requestId !== signal.pending.requestId);
      return;
    case 'pending_changed':
      state.pending = signal.pending;
      return;
    default:
      return;
  }
}

/** Replace everything the mirror holds for a computer with its heartbeat's snapshot. */
export function replaceComputerMirror(computerId: string, snapshot: WorkerLiveSnapshot): void {
  const touched = new Set<string>([
    ...snapshot.running,
    ...snapshot.pending.map((p) => p.sessionId),
    ...Object.keys(snapshot.backgroundTasks),
  ]);
  for (const [chatSessionId, state] of mirror) {
    if (state.computerId !== computerId) continue;
    if (!touched.has(chatSessionId)) {
      state.running = false;
      state.pending = [];
      state.backgroundTaskIds = [];
    }
  }
  for (const chatSessionId of touched) {
    const state = chatState(chatSessionId, computerId);
    state.running = snapshot.running.includes(chatSessionId);
    state.pending = snapshot.pending.filter((p) => p.sessionId === chatSessionId);
    state.backgroundTaskIds = snapshot.backgroundTasks[chatSessionId] ?? [];
  }
}

export function remoteChat(chatSessionId: string): RemoteChatState | null {
  return mirror.get(chatSessionId) ?? null;
}

export function listRemoteRunning(): string[] {
  return [...mirror].filter(([, s]) => s.running).map(([id]) => id);
}

export function listRemoteWithPending(): string[] {
  return [...mirror].filter(([, s]) => s.pending.length > 0).map(([id]) => id);
}

export function listRemoteWithBackgroundTasks(): string[] {
  return [...mirror].filter(([, s]) => s.backgroundTaskIds.length > 0).map(([id]) => id);
}

export function findRemotePending(requestId: string): PendingInput | null {
  for (const state of mirror.values()) {
    const found = state.pending.find((p) => p.requestId === requestId);
    if (found) return found;
  }
  return null;
}

/** Test helper. */
export function _resetRemoteLive(): void {
  mirror.clear();
}

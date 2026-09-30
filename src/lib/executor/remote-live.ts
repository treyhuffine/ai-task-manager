/**
 * The home's mirror of what's live on connected devices
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
  deviceId: string;
  running: boolean;
  pending: PendingInput[];
  backgroundTaskIds: string[];
  inventory: RuntimeCommandInventory | null;
  inventoryPosition?: number;
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
const POSITION_KEY = Symbol.for('@ri/remote-live-position');
const positionsRef = globalThis as unknown as { [POSITION_KEY]?: Map<string, number> };
const positions = positionsRef[POSITION_KEY] ??= new Map();
const ENROLLMENT_KEY = Symbol.for('@ri/remote-live-enrollment');
const enrollmentRef = globalThis as unknown as { [ENROLLMENT_KEY]?: Map<string, string> };
const enrollments = enrollmentRef[ENROLLMENT_KEY] ??= new Map();

/** Only an authenticated new enrollment may reset ordering. A low journal
 * position alone can be an older in-flight heartbeat and grants no reset. */
export function bindDeviceMirrorEnrollment(deviceId: string, keyId: string): void {
  if (enrollments.get(deviceId) === keyId) return;
  enrollments.set(deviceId, keyId);
  positions.delete(deviceId);
  for (const [chat, state] of mirror) if (state.deviceId === deviceId) mirror.delete(chat);
}

/** Heartbeats and journal replay use separate requests. A live snapshot already
 * includes every event through its journal position, even ones still in flight.
 * Applying those older signals afterward must not resurrect a crashed prompt. */
export function currentRemoteSignal(deviceId: string, position?: number): boolean {
  return position === undefined || position > (positions.get(deviceId) ?? -1);
}

function chatState(chatSessionId: string, deviceId: string): RemoteChatState {
  let state = mirror.get(chatSessionId);
  if (!state || state.deviceId !== deviceId) {
    state = { deviceId, running: false, pending: [], backgroundTaskIds: [], inventory: null };
    mirror.set(chatSessionId, state);
  }
  return state;
}

/** Fold one signal a worker reported for one of its chats. */
export function mirrorSignal(deviceId: string, chatSessionId: string, signal: RunnerSignal, position?: number): void {
  // Inventory is not part of WorkerLiveSnapshot. Order it independently so
  // a heartbeat arriving before journal replay cannot erase slash commands.
  if (signal.type === 'inventory') {
    const state = chatState(chatSessionId, deviceId);
    if (position === undefined || position > (state.inventoryPosition ?? -1)) {
      state.inventory = signal.inventory;
      if (position !== undefined) state.inventoryPosition = position;
    }
    return;
  }
  if (!currentRemoteSignal(deviceId, position)) return;
  if (position !== undefined) positions.set(deviceId, position);
  const state = chatState(chatSessionId, deviceId);
  switch (signal.type) {
    case 'running':
      state.running = signal.running;
      return;
    case 'background_tasks':
      state.backgroundTaskIds = signal.taskIds;
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

/** Replace everything the mirror holds for a device with its heartbeat's snapshot. */
export function replaceDeviceMirror(deviceId: string, snapshot: WorkerLiveSnapshot, position?: number): void {
  if (position !== undefined) {
    if (position < (positions.get(deviceId) ?? -1)) return;
    positions.set(deviceId, position);
  }
  const touched = new Set<string>([
    ...snapshot.running,
    ...snapshot.pending.map((p) => p.sessionId),
    ...Object.keys(snapshot.backgroundTasks),
  ]);
  for (const [chatSessionId, state] of mirror) {
    if (state.deviceId !== deviceId) continue;
    if (!touched.has(chatSessionId)) {
      state.running = false;
      state.pending = [];
      state.backgroundTaskIds = [];
    }
  }
  for (const chatSessionId of touched) {
    const state = chatState(chatSessionId, deviceId);
    state.running = snapshot.running.includes(chatSessionId);
    state.pending = snapshot.pending.filter((p) => p.sessionId === chatSessionId);
    state.backgroundTaskIds = snapshot.backgroundTasks[chatSessionId] ?? [];
  }
}

/** Forget what a device had live: it said it's stopping, or it no longer runs agents (P2.8). */
export function clearDeviceMirror(deviceId: string): void {
  replaceDeviceMirror(deviceId, { running: [], pending: [], backgroundTasks: {} });
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
  positions.clear();
  enrollments.clear();
}

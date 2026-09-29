/**
 * What's live across the home's runners: running flags, background tasks,
 * command inventories and pending prompts (docs/homes-build.md, P2.1 and
 * P2.4). Routes, the rail and health read here rather than from a runner
 * directly: the home's own runner for chats that run here, and the mirror of
 * each connected computer's reported state (`remote-live.ts`) for chats that
 * run there.
 *
 * Light on purpose: it imports no agent engine, so status routes stay cheap
 * to compile.
 */

import type { RuntimeCommandInventory } from '@agentex/agent';
import * as local from '@/lib/runner/live-state';
import * as localPending from '@/lib/runner/pending';
import type { PendingInput } from '@/lib/runner/pending';
import {
  findRemotePending,
  listRemoteRunning,
  listRemoteWithBackgroundTasks,
  listRemoteWithPending,
  remoteChat,
} from './remote-live';

function union(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

export function isRunning(chatSessionId: string): boolean {
  return local.isRunning(chatSessionId) || remoteChat(chatSessionId)?.running === true;
}

/** Every session with a turn in flight, here or on a connected computer. Seeds the rail's Working bucket. */
export function listRunningSessions(): string[] {
  return union(local.listRunningSessions(), listRemoteRunning());
}

export function listBackgroundTaskSessions(): string[] {
  return union(local.listBackgroundTaskSessions(), listRemoteWithBackgroundTasks());
}

export function hasBackgroundTasks(chatSessionId: string): boolean {
  return local.hasBackgroundTasks(chatSessionId) || (remoteChat(chatSessionId)?.backgroundTaskIds.length ?? 0) > 0;
}

export function listBackgroundTaskIds(chatSessionId: string): string[] {
  const here = local.listBackgroundTaskIds(chatSessionId);
  return here.length > 0 ? here : remoteChat(chatSessionId)?.backgroundTaskIds ?? [];
}

export function getSessionInventory(chatSessionId: string): RuntimeCommandInventory | null {
  return local.getSessionInventory(chatSessionId) ?? remoteChat(chatSessionId)?.inventory ?? null;
}

/** Whether this computer holds a live harness process for the chat. */
export function hasHarnessSession(chatSessionId: string): boolean {
  return local.hasHarnessSession(chatSessionId);
}

/** Sends active in this computer's runner. */
export function activeSendCount(chatSessionId: string): number {
  return local.activeSendCount(chatSessionId);
}

export function getPending(requestId: string): PendingInput | null {
  return localPending.getPending(requestId) ?? findRemotePending(requestId);
}

export function listForSession(chatSessionId: string): PendingInput[] {
  const here = localPending.listForSession(chatSessionId);
  return here.length > 0 ? here : remoteChat(chatSessionId)?.pending ?? [];
}

export function listSessionsWithPending(): string[] {
  return union(localPending.listSessionsWithPending(), listRemoteWithPending());
}

/**
 * Where an agent's main chat runs (docs/homes-spec.md P3.4, amended in
 * docs/homes-build.md, "Main chats follow their agent until they run").
 *
 * It runs where its agent lives, and stays there once it has run: its
 * native session and its history are on that device. Until then it has
 * nothing there to keep, so it follows the agent. A chat opened before its
 * agent was set up where it lives now goes there on its next open or
 * message, rather than waiting for a device that may never run it.
 */

import { cancelWorkerCommand, chatRunState, getChatSession, getDevice, getHome, getWorkspace, listEnrolledDeviceIds, updateChatSession } from '@/lib/db/queries';
import { agentDeviceFor } from '@/lib/setups/run-on';
import { withdrawQueuedSend } from '@/lib/workers/undelivered';

/**
 * Move an agent's main chat to where its agent lives, when it hasn't run
 * anywhere yet. Messages waiting for a device that runs agents stay: they're
 * delivered there when it connects. Messages waiting for one that doesn't
 * can't be, so they're withdrawn with the reason, to send again where the
 * agent is now, and whatever else waited there for it (a stop, say) is
 * dropped, since it never ran there. Anything else (the app's main chat, an execution's chat, one
 * that has run) is left as it is.
 */
export function followAgentUntilRun(chatSessionId: string): { moved: boolean; withdrawn: number } {
  const chat = getChatSession(chatSessionId);
  const unchanged = { moved: false, withdrawn: 0 };
  if (!chat || chat.status !== 'active' || chat.type !== 'orchestration' || !chat.workspaceId || chat.executionId || chat.createdByRunId) {
    return unchanged;
  }
  const workspace = getWorkspace(chat.workspaceId);
  if (!workspace) return unchanged;
  const host = getHome()?.hostDeviceId ?? null;
  const pinned = chat.deviceId && chat.deviceId !== host ? chat.deviceId : null;
  const target = agentDeviceFor(workspace.id);
  if (target === pinned) return unchanged;

  const { hasRun, queuedSends, queued } = chatRunState(chat.id);
  if (hasRun) return unchanged;
  if (queuedSends.length > 0 && pinned && listEnrolledDeviceIds().has(pinned)) return unchanged;

  const from = pinned ? (getDevice(pinned)?.name ?? 'that device') : (getDevice(host ?? '')?.name ?? 'this home');
  const to = target ? (getDevice(target)?.name ?? 'another device') : (getDevice(host ?? '')?.name ?? 'this home');
  let withdrawn = 0;
  for (const command of queued) {
    if (command.kind !== 'send') cancelWorkerCommand(command.id, `${workspace.name}'s main chat moved to ${to} before this reached ${from}.`);
    else if (withdrawQueuedSend(command.id, `${workspace.name} runs on ${to} now, and this was still waiting for ${from}. Send it again.`)) withdrawn++;
  }
  updateChatSession(chat.id, { deviceId: target });
  return { moved: true, withdrawn };
}

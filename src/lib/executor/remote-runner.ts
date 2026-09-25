/**
 * The runner for a chat that runs on a connected computer
 * (docs/homes-build.md, P2.4). Each call becomes a durable command for that
 * computer's worker, stamped with the chat's placement generation, and
 * returns once it's saved: the worker delivers it when it has it (at once
 * when connected), and what happens comes back through its event journal.
 * So a send is `queued`, not `delivered`, and a stop is `queued`, not yet
 * closed. A message to a computer that's asleep waits, saved.
 */

import type { UserInputResponse } from '@agentex/agent';
import type { WorkerCommandActor, WorkerCommandKind } from '@/db/types';
import { chatPlacement, queueWorkerCommand } from '@/lib/db/queries';
import type { ExecutionRunner } from '@/lib/runner/types';
import { wakeComputer } from '@/lib/workers/hub';
import type { SendPayload } from '@/lib/workers/protocol';
import { listForSession } from './live-state';

const SYSTEM: WorkerCommandActor = { source: 'system' };

export function remoteRunnerFor(computerId: string): ExecutionRunner {
  const queue = (
    chatSessionId: string,
    kind: WorkerCommandKind,
    payload: unknown,
    extra: { actor?: WorkerCommandActor; sourceEventId?: string | null } = {},
  ) => {
    const placement = chatPlacement(chatSessionId);
    if (!placement || placement.computerId !== computerId) {
      throw new Error(`That chat doesn't run on this computer any more.`);
    }
    const command = queueWorkerCommand({
      computerId,
      kind,
      payload,
      actor: extra.actor ?? SYSTEM,
      chatSessionId,
      executionId: placement.executionId,
      generation: placement.generation,
      sourceEventId: extra.sourceEventId ?? null,
    });
    wakeComputer(computerId);
    return command;
  };

  return {
    async send(req) {
      // A computer elsewhere may have no session for the chat yet, or a
      // stale one: it always gets the spec.
      if (!req.spec) return { status: 'needs_spec' };
      const payload: SendPayload = {
        spec: req.spec,
        message: req.message,
        turnId: req.turnId,
        runId: req.runId,
        attachments: req.files ?? [],
      };
      const command = queue(req.chatSessionId, 'send', payload, { actor: req.actor, sourceEventId: req.sourceEventId });
      return { status: 'queued', commandId: command.id };
    },
    async interrupt(chatSessionId) {
      queue(chatSessionId, 'interrupt', null);
    },
    async stopTask(chatSessionId, taskId) {
      queue(chatSessionId, 'stop_task', { taskId });
      return { stopped: false, queued: true };
    },
    async stop(chatSessionId) {
      queue(chatSessionId, 'stop', null);
      return { closed: false, queued: true };
    },
    answerPendingInput(chatSessionId: string, requestId: string, response: UserInputResponse) {
      // Only a prompt this chat raised, as its computer last reported.
      const pending = listForSession(chatSessionId).find((p) => p.requestId === requestId);
      if (!pending) return { ok: false };
      queue(chatSessionId, 'answer_pending_input', { requestId, response });
      return { ok: true, pending };
    },
  };
}

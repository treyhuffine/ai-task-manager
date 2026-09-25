/**
 * What the home knows about running a chat on a given computer
 * (docs/homes-build.md, P2.4): a harness's capabilities there, and the
 * folder the chat runs in there. For the home's own computer both come from
 * here. For a connected computer, the capabilities come from its worker's
 * last heartbeat and the folder from its placement or its setup report: the
 * home never looks for a connected computer's paths on its own disk.
 */

import type { ChatSessionWithExecution } from '@/db/types';
import type { ChatPlacement } from '@/lib/db/queries';
import { getAgentSetup, getComputer } from '@/lib/db/queries';
import { getHarnessRuntime } from '@/lib/harness/runtime';
import type { HarnessId } from '@/lib/harness/registry';

export interface HarnessCapabilities {
  sessions: boolean;
  /** Why sessions aren't available, when they aren't. */
  sessionsReason: string | null;
  concurrentSend: boolean;
  strictMcpIsolation: boolean;
  planMode: boolean;
  modelVariants: boolean;
  reasoningEffort: boolean;
}

export async function harnessCapabilitiesOn(
  placement: Pick<ChatPlacement, 'computerId' | 'isHome'>,
  harness: HarnessId,
  cwd?: string,
): Promise<HarnessCapabilities> {
  if (placement.isHome) {
    const runtime = await getHarnessRuntime(harness, { cwd });
    const c = runtime.capabilities;
    return {
      sessions: c.sessions.supported,
      sessionsReason: c.sessions.reason ?? null,
      concurrentSend: c.concurrentSend.supported,
      strictMcpIsolation: c.strictMcpIsolation.supported,
      planMode: c.planMode.supported,
      modelVariants: c.modelVariants.supported,
      reasoningEffort: c.reasoningEffort.supported,
    };
  }
  const computer = getComputer(placement.computerId);
  const name = computer?.name ?? 'that computer';
  const report = computer?.harnesses?.find((h) => h.harness === harness);
  const supported = (key: string) => report?.capabilities[key]?.supported === true;
  if (!report || report.binary.status !== 'supported') {
    return {
      sessions: false,
      sessionsReason: report
        ? `${harness} isn't usable on ${name} (${report.binary.status}).`
        : `${name} hasn't reported ${harness}. Connect its worker, or install ${harness} there.`,
      concurrentSend: false,
      strictMcpIsolation: false,
      planMode: false,
      modelVariants: false,
      reasoningEffort: false,
    };
  }
  return {
    sessions: supported('sessions'),
    sessionsReason: supported('sessions') ? null : report.capabilities.sessions?.reason ?? `${harness} sessions aren't available on ${name}.`,
    concurrentSend: supported('concurrentSend'),
    strictMcpIsolation: supported('strictMcpIsolation'),
    planMode: supported('planMode'),
    modelVariants: supported('modelVariants'),
    reasoningEffort: supported('reasoningEffort'),
  };
}

/**
 * The folder a chat runs in on a connected computer: its execution's
 * worktree there (or, while that's being prepared, the promise of it), or
 * for an agent's main chat, the agent's folder as that computer reported it.
 * A problem names what's missing.
 */
export function workingFolderOn(
  placement: ChatPlacement,
  session: Pick<ChatSessionWithExecution, 'type' | 'workspaceId' | 'executionId'>,
): { cwd: string } | { preparing: string } | { problem: string } {
  const name = getComputer(placement.computerId)?.name ?? 'that computer';
  if (placement.executionId) {
    // Not prepared yet: the worktree it's preparing there, once it has.
    return placement.worktreePath ? { cwd: placement.worktreePath } : { preparing: placement.executionId };
  }
  if (session.type === 'orchestration' && session.workspaceId) {
    const setup = getAgentSetup(session.workspaceId, placement.computerId);
    if (setup?.status === 'ready') return { cwd: setup.sourcePath };
    return {
      problem: setup
        ? `This agent's folder on ${name} isn't ready: ${setup.problem ?? setup.status}.`
        : `This agent isn't set up on ${name}. Attach its folder there first.`,
    };
  }
  return { problem: `Only an agent's work runs on ${name}. This chat runs on your home.` };
}

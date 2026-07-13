/**
 * Sweep lifecycle (spec §3.7). The runner IS a harness session driven by
 * three actions:
 *
 *   begin_stream_sweep  → beginSweep(): opens the pass (single-flight),
 *                         resurfaces due incubating items, assembles
 *                         context, returns the constitution + data
 *   (the agent works through the disposition actions)
 *   finish_stream_sweep → finishSweep(): finalizes counts + summary, runs
 *                         the graduation engine, returns digest lines
 *
 * A sweep that never finishes is reaped by the 10-minute staleness rule in
 * findRunningTriagePass — items stay pending, never half-disposed.
 */

import {
  createTriagePass,
  completeTriagePass,
  getTriagePass,
  listStream,
  resurfaceDueStreamItems,
  TriageError,
  type ResolvedStreamAutonomy,
} from '@/lib/db/queries';
import type { TriagePassRecord, TriagePassTrigger } from '@/db/types';
import { buildTriageContext, type TriageSweepContext } from './context';
import { SWEEP_CONSTITUTION } from './prompt';
import { evaluateAllGraduations, describeGraduation, type GraduationSweepResult } from './autonomy';
import { dispatchImmediateSweep } from './triggers';

export interface SweepBundle {
  passId: string;
  instructions: string;
  context: TriageSweepContext;
}

/**
 * Open a pass and hand the agent everything it needs. Throws
 * TriageError('conflict') when a live sweep already holds the lock.
 */
export async function beginSweep(
  trigger: TriagePassTrigger,
  opts: { sessionId?: string | null; urgentItemId?: string } = {},
): Promise<SweepBundle> {
  // Incubation: due items return to pending so this sweep sees them.
  resurfaceDueStreamItems();

  const pass = createTriagePass(trigger, { sessionId: opts.sessionId ?? null });
  try {
    const context = await buildTriageContext({ urgentItemId: opts.urgentItemId });
    return { passId: pass.id, instructions: SWEEP_CONSTITUTION, context };
  } catch (err) {
    // Context assembly failed — release the lock instead of wedging the
    // queue for 10 minutes.
    const { failTriagePass } = await import('@/lib/db/queries');
    failTriagePass(pass.id, `Context assembly failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

export interface SweepCompletion {
  pass: TriagePassRecord;
  graduations: GraduationSweepResult;
  /** Ready-to-show digest lines for offers + demotions (calm copy). */
  graduationLines: string[];
}

/**
 * Finalize the pass and evaluate autonomy. Demotions apply automatically;
 * offers come back as digest lines for the user to accept.
 */
export function finishSweep(passId: string, summary: string, itemsSeen?: number): SweepCompletion {
  const existing = getTriagePass(passId);
  if (!existing) throw new TriageError('not_found', `Triage pass not found: ${passId}`);
  if (existing.status === 'failed') {
    throw new TriageError('conflict', 'This pass was marked stale/failed. Start a new sweep.');
  }
  const pass = completeTriagePass(passId, { summary, itemsSeen }) ?? existing;
  const graduations = evaluateAllGraduations();
  const graduationLines = [
    ...graduations.demotions.map(describeGraduation),
    ...graduations.offers.map(describeGraduation),
  ].filter(Boolean);
  return { pass, graduations, graduationLines };
}

/**
 * Manual entry point (Triage button / "triage my stream" in chat when the
 * user wants a background run). Dispatches the sweep session immediately
 * instead of waiting for the scheduler tick.
 */
export async function startManualSweep(): Promise<
  | { started: true; runId: string; chatSessionId: string | null }
  | { started: false; reason: 'empty' | 'already_running' | 'dispatch_failed' }
> {
  const pendingCount = listStream({ status: 'pending', limit: 1 }).length;
  if (pendingCount === 0) return { started: false, reason: 'empty' };

  const { findRunningTriagePass } = await import('@/lib/db/queries');
  if (findRunningTriagePass()) return { started: false, reason: 'already_running' };

  const dispatched = await dispatchImmediateSweep('Manual triage requested from the stream tab.');
  if (!dispatched) return { started: false, reason: 'dispatch_failed' };
  return { started: true, runId: dispatched.runId, chatSessionId: dispatched.chatSessionId };
}

export type { ResolvedStreamAutonomy };

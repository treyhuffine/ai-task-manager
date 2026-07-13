/**
 * Lane 1: wait-risk detection (spec §3.8 / §1.7).
 *
 * Immediately after a capture's text is readable, answer one narrow
 * question: could waiting ~20 minutes for the batch sweep make the user
 * miss a real commitment? Three tiers, cheapest first:
 *
 *   1. Deterministic pre-scan for time/date language. No hits → wait_safe,
 *      zero model calls. The common case stays free.
 *   2. One small structured model call. Must cite exact source words;
 *      uncited urgency is discarded IN CODE, not by prompt trust.
 *   3. Outcomes: the strict urgent-reminder carve-out auto-creates the
 *      reminder task (explicit imperative + explicit time + cited
 *      evidence, one-tap undo via its decision row); any other
 *      time_sensitive capture skips the debounce with an immediate
 *      single-item sweep.
 *
 * The whole lane is an accelerator, never a gate: every failure path
 * swallows and leaves the capture to normal batch triage.
 */

import { z } from 'zod';
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import {
  getStream,
  getUserState,
  getTrigger,
  getStreamAutonomy,
  createTriagePass,
  completeTriagePass,
  findRunningTriagePass,
  recordTriageDecisionAndApply,
  firstLineTitle,
  streamRawTextIsPlaceholder,
  TriageError,
} from '@/lib/db/queries';
import { RESERVED_TRIGGER_IDS } from '@/lib/triggers/reserved';
import { dispatchImmediateSweep } from './triggers';

/** Time/date language that justifies spending a model call. */
const TIME_LANGUAGE_RE = new RegExp(
  [
    '\\b(today|tonight|tomorrow|noon|midnight|morning|afternoon|evening)\\b',
    '\\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b',
    '\\b(at|by|before|until|due|deadline)\\s+\\d',
    '\\b\\d{1,2}(:\\d{2})?\\s*(am|pm)\\b',
    '\\bin\\s+\\d+\\s+(minute|minutes|min|hour|hours|hr|hrs)\\b',
    '\\bremind me\\b',
    '\\b(asap|urgent|end of day|eod)\\b',
    '\\b\\d{1,2}[/-]\\d{1,2}\\b',
  ].join('|'),
  'i',
);

export function hasTimeLanguage(text: string): boolean {
  return TIME_LANGUAGE_RE.test(text);
}

const urgencyResultSchema = z.object({
  verdict: z.enum(['wait_safe', 'time_sensitive']),
  /** Exact words from the capture that establish the time sensitivity. */
  evidence: z.string().optional(),
  /**
   * Present ONLY when the strict reminder carve-out applies: an explicit
   * imperative plus an explicit time ("remind me at 3pm to send the deck").
   * Anything softer must be omitted.
   */
  urgentReminder: z
    .object({
      title: z.string().min(1),
      reminderAt: z.string().describe('ISO 8601 datetime in the user timezone'),
    })
    .optional(),
});

export type UrgencyOutcome =
  | { lane: 'wait_safe'; reason: string }
  | { lane: 'reminder_created'; taskId: string; decisionId: string }
  | { lane: 'sweep_dispatched' };

/** Normalized substring check: the model's citation must actually appear
 *  in the capture. Uncited urgency is treated as wait_safe. */
function evidenceAppearsIn(rawText: string, evidence: string | undefined): boolean {
  if (!evidence?.trim()) return false;
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return normalize(rawText).includes(normalize(evidence));
}

const URGENCY_SYSTEM_PROMPT = `You are a narrow time-sensitivity check for a personal capture inbox. Decide ONLY whether waiting about 20 minutes to process this capture could make the user miss a real commitment or time-sensitive action.

Rules:
- verdict is "time_sensitive" only when the capture itself states a concrete time pressure inside roughly the next 24 hours. Someday-ish intentions, vague "soon", and dates weeks away are wait_safe.
- When time_sensitive, evidence MUST quote the exact words from the capture that establish it. No paraphrase.
- Fill urgentReminder ONLY for an explicit imperative with an explicit clock time or unambiguous relative time ("remind me at 3pm to send the deck", "call Sam in 30 minutes"). A mentioned deadline without an instruction is NOT an urgentReminder.
- reminderAt must be a concrete ISO datetime resolved against the provided current time and timezone, in the future.
- You do no organizing, no merging, no note work. One question only.`;

/**
 * Run the lane for one capture. Errors are swallowed by design — callers
 * fire-and-forget (see onStreamCaptured).
 */
export async function runUrgencyLane(itemId: string): Promise<UrgencyOutcome> {
  const item = getStream(itemId);
  if (!item) return { lane: 'wait_safe', reason: 'item gone' };
  if (item.status !== 'pending') return { lane: 'wait_safe', reason: `status ${item.status}` };
  if (streamRawTextIsPlaceholder(item.rawText)) {
    return { lane: 'wait_safe', reason: 'awaiting preprocessing' };
  }
  if (!hasTimeLanguage(item.rawText)) {
    return { lane: 'wait_safe', reason: 'no time language' };
  }

  // Manual-only mode disables the automatic cadence entirely — the lane
  // must not sneak a sweep in through the side door. (The user's Triage
  // button still works: it goes through startManualSweep, not here.)
  const cadenceEnabled = getTrigger(RESERVED_TRIGGER_IDS.streamSweepDebounce)?.enabled ?? false;
  if (!cadenceEnabled) {
    return { lane: 'wait_safe', reason: 'automatic triage is off (manual only)' };
  }

  const state = getUserState();
  const timezone = state?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  let result: z.infer<typeof urgencyResultSchema>;
  try {
    const model = process.env.MODEL_STANDARD || 'gpt-5.4-mini';
    const generated = await generateObject({
      model: openai(model),
      schema: urgencyResultSchema,
      system: URGENCY_SYSTEM_PROMPT,
      prompt: `Current time: ${new Date().toISOString()} (timezone: ${timezone})\n\nCapture:\n${item.rawText.slice(0, 4_000)}`,
      temperature: 0,
    });
    result = generated.object;
  } catch (err) {
    // Model unavailable but the pre-scan saw time language: still skip the
    // debounce so the batch brain looks at it right away.
    console.warn('[stream-triage] urgency model call failed, dispatching sweep on pre-scan hit:', err);
    await dispatchImmediateSweep(
      `A just-captured item may be time-sensitive (automatic check unavailable). Look at stream item ${item.id} first.`,
    );
    return { lane: 'sweep_dispatched' };
  }

  if (result.verdict !== 'time_sensitive' || !evidenceAppearsIn(item.rawText, result.evidence)) {
    return { lane: 'wait_safe', reason: result.verdict === 'time_sensitive' ? 'evidence not cited from source' : 'model says wait_safe' };
  }

  // Strict carve-out: auto-create the reminder task with one-tap undo.
  // NEVER past the kill switch — with it on, everything waits for the user
  // (the immediate sweep below will propose instead).
  const reminder = result.urgentReminder;
  const killSwitch = getStreamAutonomy().killSwitch;
  if (
    !killSwitch &&
    reminder &&
    !Number.isNaN(Date.parse(reminder.reminderAt)) &&
    Date.parse(reminder.reminderAt) > Date.now()
  ) {
    try {
      const pass = tryOpenUrgencyPass();
      const applied = recordTriageDecisionAndApply(
        {
          disposition: 'promote_task',
          streamItemIds: [item.id],
          draft: {
            title: reminder.title.trim() || firstLineTitle(item.rawText),
            body: item.rawText,
            reminderAt: reminder.reminderAt,
            evidence: result.evidence,
          },
          rationale: `Time-sensitive: "${result.evidence!.trim()}"`,
          confidence: 1,
          passId: pass?.id ?? null,
          actor: 'agent',
        },
        'executed',
      );
      // Close the pass ONLY if this lane opened it — never finalize a live
      // sweep's pass out from under it.
      if (pass?.owned) {
        completeTriagePass(pass.id, {
          summary: `Set a reminder right away: ${reminder.title.trim()} (${reminder.reminderAt}).`,
          itemsSeen: 1,
        });
      }
      return {
        lane: 'reminder_created',
        taskId: applied.entity!.entityId,
        decisionId: applied.decision.id,
      };
    } catch (err) {
      if (!(err instanceof TriageError)) console.warn('[stream-triage] urgent reminder creation failed:', err);
      // Fall through to the sweep path — the item is still pending.
    }
  }

  await dispatchImmediateSweep(
    `URGENT: stream item ${item.id} is time-sensitive (evidence: "${result.evidence!.trim()}"). Triage it first, ahead of anything else.`,
  );
  return { lane: 'sweep_dispatched' };
}

/** An urgency micro-pass groups the auto-applied reminder into the digest.
 *  When a full sweep is already running, attach to that pass instead —
 *  `owned` says whether this lane is responsible for closing it. */
function tryOpenUrgencyPass(): { id: string; owned: boolean } | null {
  const running = findRunningTriagePass();
  if (running) return { id: running.id, owned: false };
  try {
    return { id: createTriagePass('urgency').id, owned: true };
  } catch {
    return null;
  }
}

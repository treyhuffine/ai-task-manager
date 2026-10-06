/**
 * Triggers and their run history for the dev seed.
 *
 * A dev server often runs for days, so nothing seeded here fires on its own
 * schedule: every time-based trigger is paused (the morning deck refresh,
 * heartbeat and stream triage sweeps included), and the enabled ones are
 * manual or webhook triggers, which only run when asked. Run history covers completed, failed, skipped
 * and cancelled runs with real durations, tokens and cost, plus a trigger
 * that was switched off after three failures in a row.
 */

import { uuidv7 } from 'uuidv7';
import type { AgentSlug } from './tasks';
import { daysAgo, ms, plus } from './time';

interface AutomationCtx {
  q: typeof import('../../src/lib/db/queries');
  db: ReturnType<typeof import('../../src/lib/db').getDb>;
  schema: typeof import('../../src/lib/db/schema');
  eq: typeof import('drizzle-orm').eq;
  workspaceIds: Map<AgentSlug, string>;
  execIds: Map<string, { executionId: string; chatId: string }>;
}

interface RunSpec {
  at: string;
  status: 'completed' | 'failed' | 'skipped' | 'cancelled';
  minutes?: number;
  cost?: number;
  summary?: string;
  error?: [code: string, message: string];
  reason?: string;
}

interface TriggerSpec {
  name: string;
  description: string;
  enabled: boolean;
  target: { agent: AgentSlug } | 'orchestrator';
  kind: 'manual' | 'cron' | 'webhook' | 'every';
  cron?: string;
  intervalSeconds?: number;
  prompt: string;
  createdAt: string;
  disabledReason?: string;
  runs: RunSpec[];
}

const specs: TriggerSpec[] = [
  {
    name: 'Weekly review',
    description: 'Sunday evening: what got done, what slipped, what next week needs.',
    enabled: false,
    target: 'orchestrator',
    kind: 'cron',
    cron: '0 18 * * 0',
    prompt: 'Run my weekly review. List what I finished this week, what slipped and why, and the three things next week depends on. Write it as a note titled "Weekly review: <date>".',
    createdAt: daysAgo(40, 19, 0),
    runs: [
      { at: daysAgo(29, 18, 0), status: 'completed', minutes: 3.1, cost: 0.41, summary: 'Wrote "Weekly review" with 11 finished, 3 slipped (skylight, Thanksgiving plan, insurance quotes).' },
      { at: daysAgo(22, 18, 0), status: 'completed', minutes: 2.6, cost: 0.37, summary: 'Wrote the weekly review. Flagged the panel upgrade quote as expiring.' },
      { at: daysAgo(15, 18, 0), status: 'skipped', reason: 'The computer was asleep at the scheduled time.' },
      { at: daysAgo(8, 18, 0), status: 'completed', minutes: 2.9, cost: 0.39, summary: 'Wrote the weekly review. Sync bug and roaster hiring are next week\'s focus.' },
    ],
  },
  {
    name: 'Weekly wholesale invoice check',
    description: 'Monday morning: check that every wholesale delivery last week has an invoice.',
    enabled: false,
    target: { agent: 'tidewater-shop' },
    kind: 'cron',
    cron: '0 8 * * 1',
    prompt: 'Compare last week\'s wholesale deliveries with sent invoices and list any delivery without one. Do not send anything.',
    createdAt: daysAgo(33, 9, 30),
    disabledReason: 'worktree_setup_failed',
    runs: [
      { at: daysAgo(27, 8, 0), status: 'completed', minutes: 4.2, cost: 0.33, summary: 'All 6 deliveries invoiced.' },
      { at: daysAgo(20, 8, 0), status: 'completed', minutes: 3.8, cost: 0.29, summary: 'Northside Bakery\'s delivery on the 14th has no invoice.' },
      { at: daysAgo(13, 8, 0), status: 'failed', minutes: 0.4, error: ['setup_failed', 'pnpm install failed: getaddrinfo ENOTFOUND registry.npmjs.org'] },
      { at: daysAgo(6, 8, 0), status: 'failed', minutes: 0.4, error: ['setup_failed', 'pnpm install failed: getaddrinfo ENOTFOUND registry.npmjs.org'] },
      { at: daysAgo(6, 8, 30), status: 'failed', minutes: 0.3, error: ['setup_failed', 'pnpm install failed: getaddrinfo ENOTFOUND registry.npmjs.org'] },
    ],
  },
  {
    name: 'Fieldnote crash reports',
    description: 'When TestFlight sends a crash report, find the cause and propose a fix.',
    enabled: true,
    target: { agent: 'fieldnote-ios' },
    kind: 'webhook',
    prompt: 'A TestFlight crash report arrived (payload attached). Find the likely cause in the code, and if it is clear, propose a fix on a branch. Do not push.',
    createdAt: daysAgo(18, 22, 0),
    runs: [
      { at: daysAgo(11, 23, 12), status: 'completed', minutes: 6.4, cost: 0.58, summary: 'Crash in SightingListView when the list is empty on first launch. Proposed a fix on a branch.' },
      { at: daysAgo(11, 23, 13), status: 'skipped', reason: 'A run for this trigger was already active, so this report joined it.' },
      { at: daysAgo(3, 7, 48), status: 'completed', minutes: 4.9, cost: 0.44, summary: 'Same root cause as the sync bug: the upload task is cancelled when the app is suspended.' },
    ],
  },
  {
    name: 'Draft the subscription box insert',
    description: 'Write the card that goes in this month\'s subscription box.',
    enabled: true,
    target: 'orchestrator',
    kind: 'manual',
    prompt: 'Draft this month\'s subscription box insert: the two coffees, tasting notes from the roast profile notes, a brewing tip, under 120 words. Save it as a note.',
    createdAt: daysAgo(35, 15, 0),
    runs: [
      { at: daysAgo(34, 15, 5), status: 'completed', minutes: 1.8, cost: 0.12, summary: 'Saved "Subscription insert: September" (Huila washed and House blend).' },
      { at: daysAgo(4, 13, 20), status: 'cancelled', minutes: 0.2, reason: 'Stopped by you.' },
    ],
  },
  {
    name: 'Market day prep',
    description: 'Friday afternoon: the Saturday market packing list from current stock.',
    enabled: false,
    target: 'orchestrator',
    kind: 'cron',
    cron: '0 15 * * 5',
    prompt: 'Make the packing list for tomorrow\'s farmers market from current stock and last month\'s sales. Note anything we are short on.',
    createdAt: daysAgo(25, 16, 0),
    runs: [
      { at: daysAgo(17, 15, 0), status: 'completed', minutes: 2.2, cost: 0.18, summary: 'Packing list ready. Short on 12 oz bags (40 left).' },
      { at: daysAgo(10, 15, 0), status: 'completed', minutes: 2.0, cost: 0.17, summary: 'Packing list ready. Bring the decaf sign back.' },
      { at: daysAgo(3, 15, 0), status: 'completed', minutes: 2.4, cost: 0.2, summary: 'Packing list ready. Rain forecast, pack the canopy weights.' },
    ],
  },
];

export function seedAutomations(ctx: AutomationCtx): { triggers: number; runs: number } {
  const { q, db, schema, eq, workspaceIds } = ctx;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let runs = 0;


  for (const spec of specs) {
    const workspaceId = spec.target === 'orchestrator' ? null : workspaceIds.get(spec.target.agent)!;
    const trigger = q.createTrigger({
      name: spec.name,
      description: spec.description,
      enabled: spec.enabled,
      harness: 'claude',
      workspaceId,
      targetKind: spec.target === 'orchestrator' ? 'orchestrator' : 'workspace',
      prompt: spec.prompt,
      kind: spec.kind,
      cronExpression: spec.cron ?? null,
      intervalSeconds: spec.intervalSeconds ?? null,
      timezone,
      ...(spec.kind === 'webhook' ? { webhookPublicId: uuidv7().replaceAll('-', '').slice(0, 20) } : {}),
      createdAt: spec.createdAt,
      updatedAt: spec.createdAt,
    });
    let last: { id: string; status: RunSpec['status']; at: string } | null = null;
    let failures = 0;
    for (const r of spec.runs) {
      const durationMs = Math.round((r.minutes ?? 0) * ms.minute);
      const started = r.status === 'skipped' ? null : plus(r.at, 4 * ms.second);
      const tokensIn = Math.round(durationMs / 9);
      const run = q.createRun({
        triggerId: trigger.id,
        workspaceId,
        harness: 'claude',
        triggerKind: spec.kind === 'manual' ? 'manual' : spec.kind,
        triggerPayload: spec.kind === 'webhook' ? { source: 'testflight', build: '1.0 (37)', crash: 'EXC_BAD_ACCESS in SightingListView' } : null,
        scheduledFor: r.at,
        status: r.status,
        statusReason: r.reason ?? null,
        queuedAt: r.at,
        startedAt: started,
        completedAt: started ? plus(started, durationMs) : r.at,
        durationMs: started ? durationMs : null,
        model: 'claude-opus-5-5',
        inputTokens: tokensIn,
        outputTokens: Math.round(tokensIn / 6),
        cachedInputTokens: Math.round(tokensIn * 3.2),
        cacheCreationInputTokens: Math.round(tokensIn / 4),
        costUsd: r.cost ?? 0,
        summary: r.summary ?? null,
        errorCode: r.error?.[0] ?? null,
        errorMessage: r.error?.[1] ?? null,
        createdAt: r.at,
      });
      runs++;
      if (r.status === 'failed') failures++;
      else if (r.status === 'completed') failures = 0;
      last = { id: run.id, status: r.status, at: r.at };
    }
    const lastStatus = last && last.status !== 'cancelled' ? last.status : null;
    db.update(schema.triggers).set({
      lastFiredAt: last?.at ?? null,
      lastRunId: last?.id ?? null,
      lastRunStatus: lastStatus,
      consecutiveFailures: failures,
      disabledReason: spec.disabledReason ?? null,
      nextRunAt: null,
    }).where(eq(schema.triggers.id, trigger.id)).run();
  }
  return { triggers: specs.length, runs };
}

/**
 * Create the reserved rows the server seeds on boot, and pause every one that
 * runs on a clock: the morning deck refresh, the heartbeat, and the morning
 * and weekly stream triage sweeps. Boot only creates missing rows and never
 * re-enables one, so they stay paused. The capture debounce stays on: it only
 * runs after you capture something in dev.
 */
export async function pauseReservedTriggers(): Promise<void> {
  const { setMorningDeckConfig } = await import('../../src/lib/deck/trigger');
  const { ensureHeartbeatTrigger } = await import('../../src/lib/heartbeat/trigger');
  const { ensureStreamTriageTriggers } = await import('../../src/lib/stream-triage/triggers');
  const { RESERVED_TRIGGER_IDS } = await import('../../src/lib/triggers/reserved');
  const { updateTrigger } = await import('../../src/lib/db/queries');
  setMorningDeckConfig({ enabled: false, time: '05:00' });
  ensureHeartbeatTrigger();
  ensureStreamTriageTriggers();
  for (const id of [RESERVED_TRIGGER_IDS.morningStreamSweep, RESERVED_TRIGGER_IDS.weeklyStreamDigest]) {
    updateTrigger(id, { enabled: false, nextRunAt: null });
  }
}

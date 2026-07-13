/**
 * Triage metrics (spec §3.14) — pure queries over triage_decisions,
 * stream, and stream_links. Rendered by the weekly meta-digest; no new
 * analytics infrastructure.
 */

import {
  listStream,
  listTriageDecisions,
  getAcceptanceStats,
  getStreamAutonomy,
  type AcceptanceStats,
} from '@/lib/db/queries';
import { getDb } from '@/lib/db';
import { stream, streamLinks, tasks, entityVersions } from '@/lib/db/schema';
import { and, eq, gte, inArray, isNull, notExists, sql } from 'drizzle-orm';

export interface TriageMetrics {
  windowDays: number;
  acceptance: AcceptanceStats[];
  /** Median hours from capture to terminal disposition. Null = no data. */
  timeToClarityHoursMedian: number | null;
  /** 95th percentile age (hours) of currently pending captures. */
  pendingAgeP95Hours: number | null;
  pendingCount: number;
  /** Share of applied dispositions that were journal. The over-promotion
   *  guardrail: suspiciously low means the agent is inflating the task list. */
  journalShare: number | null;
  /** Engagement (completed / human-edited / touched within 14 days) of
   *  stream-born vs manually created tasks. */
  overPromotion: {
    streamBornEngagement: number | null;
    manualEngagement: number | null;
    streamBornCount: number;
    manualCount: number;
  };
  autonomy: ReturnType<typeof getStreamAutonomy>;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

const ENGAGEMENT_WINDOW_DAYS = 14;

function taskEngagement(sinceIso: string, streamBorn: boolean): { rate: number | null; count: number } {
  const db = getDb();
  const linkExists = sql`EXISTS (SELECT 1 FROM ${streamLinks} WHERE ${streamLinks.entityType} = 'task' AND ${streamLinks.entityId} = ${tasks.id})`;
  const rows = db
    .select({ id: tasks.id, status: tasks.status, createdAt: tasks.createdAt, updatedAt: tasks.updatedAt, lastViewedAt: tasks.lastViewedAt })
    .from(tasks)
    .where(and(gte(tasks.createdAt, sinceIso), streamBorn ? linkExists : sql`NOT ${linkExists}`))
    .all();
  if (rows.length === 0) return { rate: null, count: 0 };
  const humanEdited = new Set(
    db
      .select({ entityId: entityVersions.entityId })
      .from(entityVersions)
      .where(and(eq(entityVersions.entityType, 'task'), eq(entityVersions.source, 'human'), gte(entityVersions.createdAt, sinceIso)))
      .all()
      .map((r) => r.entityId),
  );
  const engaged = rows.filter(
    (t) => t.status === 'done' || humanEdited.has(t.id) || (t.lastViewedAt && t.lastViewedAt > t.createdAt) || t.updatedAt > t.createdAt,
  ).length;
  return { rate: engaged / rows.length, count: rows.length };
}

export function getTriageMetrics(windowDays = 30): TriageMetrics {
  const nowMs = Date.now();
  const sinceIso = new Date(nowMs - windowDays * 86_400_000).toISOString();

  // Time to clarity: capture → first applied decision, for items captured
  // inside the window that have reached a terminal disposition.
  const applied = listTriageDecisions({ state: ['executed', 'accepted'], sinceDays: windowDays, limit: 5_000 });
  const firstDecisionByItem = new Map<string, string>();
  for (const d of applied) {
    const decidedAt = d.decidedAt ?? d.updatedAt;
    for (const itemId of d.streamItemIds) {
      const existing = firstDecisionByItem.get(itemId);
      if (!existing || decidedAt < existing) firstDecisionByItem.set(itemId, decidedAt);
    }
  }
  const db = getDb();
  const clarityHours: number[] = [];
  if (firstDecisionByItem.size > 0) {
    const items = db
      .select({ id: stream.id, createdAt: stream.createdAt })
      .from(stream)
      .where(inArray(stream.id, [...firstDecisionByItem.keys()]))
      .all();
    for (const item of items) {
      const decided = firstDecisionByItem.get(item.id)!;
      const hours = (new Date(decided).getTime() - new Date(item.createdAt).getTime()) / 3_600_000;
      if (hours >= 0) clarityHours.push(hours);
    }
  }
  clarityHours.sort((a, b) => a - b);

  const pending = listStream({ status: 'pending', limit: 1000 });
  const pendingAges = pending
    .map((i) => (nowMs - new Date(i.createdAt).getTime()) / 3_600_000)
    .sort((a, b) => a - b);

  const journalCount = applied.filter((d) => d.disposition === 'journal').length;

  return {
    windowDays,
    acceptance: getAcceptanceStats({ windowDays }),
    timeToClarityHoursMedian: percentile(clarityHours, 0.5),
    pendingAgeP95Hours: percentile(pendingAges, 0.95),
    pendingCount: pending.length,
    journalShare: applied.length > 0 ? journalCount / applied.length : null,
    overPromotion: (() => {
      const engagementSince = new Date(nowMs - ENGAGEMENT_WINDOW_DAYS * 86_400_000).toISOString();
      const streamBorn = taskEngagement(engagementSince, true);
      const manual = taskEngagement(engagementSince, false);
      return {
        streamBornEngagement: streamBorn.rate,
        manualEngagement: manual.rate,
        streamBornCount: streamBorn.count,
        manualCount: manual.count,
      };
    })(),
    autonomy: getStreamAutonomy(),
  };
}

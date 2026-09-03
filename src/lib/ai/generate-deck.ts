/**
 * Deck generation pipeline, callable from any server-side surface.
 *
 * Extracted from `POST /api/deck/generate` so the orchestrator
 * `regenerate_deck` action (CLI + MCP) can run the pipeline directly
 * instead of bouncing through HTTP. The route stays as the thin
 * HTTP wrapper for the web UI.
 *
 * Three phases (see docs/deck-v2-spec.md):
 *   1. Deterministic context — DB queries for active/deadline/recurring
 *      tasks, areas, recent completions.
 *   2. AI context gathering — a small model runs hybrid search over the
 *      knowledge base for anything the task list alone doesn't surface.
 *   3. Structured generation — the standard model emits the ranked deck.
 *
 * Requires OPENAI_API_KEY (both AI phases run on OpenAI models).
 */

import { Output, generateText, tool, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { tasks, areas, taskCompletions } from '@/lib/db/schema';
import type { DeckItem, DeckChange, DeckOrigin } from '@/lib/db/schema';
import type { DeckRecord } from '@/db/types';
import { eq, and, or, desc, sql, isNull, isNotNull, gte, lte, inArray } from 'drizzle-orm';
import { isReady, normalizeTaskStatus } from '@/lib/tasks/lifecycle';
import { getLatestDeck, supersedeAndInsertDeck, getUserState } from '@/lib/db/queries';
import { todayLocalDate } from '@/lib/deck/date';
import {
  getCalendarEventsForDay,
  computeFreeGaps,
  availableMinutes,
  formatGap,
} from '@/lib/deck/calendar';
import { readDeckInstructions } from '@/lib/deck/instructions';
import { getReadOnlyConnectorTools } from '@/lib/deck/connector-tools';
import { hybridSearchWithEntities } from '@/lib/embeddings/search';
import {
  DECK_GENERATION_TASK_LIMIT,
  DECK_SYSTEM_PROMPT,
  CONTEXT_GATHERING_PROMPT,
  type DeckGenerationContext,
  deckResponseSchema,
  buildDeckPrompt,
} from '@/lib/ai/deck-generation';

// ─── Search tool ────────────────────────────────────────────────

const searchKnowledgeBase = tool({
  description:
    "Search the user's knowledge base (tasks, notes, and stream-of-consciousness entries) using semantic + keyword hybrid search. Returns matching entities with relevance scores.",
  inputSchema: z.object({
    query: z.string().describe('Search query: a topic, keyword, or natural language phrase'),
  }),
  execute: async ({ query }) => {
    try {
      return await hybridSearchWithEntities(query, { limit: 8 });
    } catch {
      return [];
    }
  },
});

// ─── Collect search results from tool-use steps ─────────────────

function collectSearchResults(
  steps: { toolResults: Array<{ toolName: string; output: unknown }> }[],
): string {
  const results: unknown[] = [];
  for (const step of steps) {
    for (const tr of step.toolResults) {
      if (tr.toolName === 'searchKnowledgeBase' && Array.isArray(tr.output)) {
        results.push(...tr.output);
      }
    }
  }
  if (results.length === 0) return '';

  // Deduplicate by entity id
  const seen = new Set<string>();
  const unique = results.filter((r) => {
    const id = (r as Record<string, unknown>).id as string;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return unique
    .map((r) => {
      const rec = r as Record<string, unknown>;
      const type = rec.type as string;
      if (type === 'task') {
        return `- Task: "${rec.title}"${rec.description ? `: ${rec.description}` : ''}${rec.userContext ? ` (note: ${rec.userContext})` : ''}`;
      }
      if (type === 'note') {
        const body = rec.body as string | undefined;
        const snippet = body ? `: ${body.slice(0, 200)}${body.length > 200 ? '...' : ''}` : '';
        return `- Note: "${rec.title}"${snippet}`;
      }
      if (type === 'stream') {
        const text = rec.rawText as string | undefined;
        const snippet = text ? text.slice(0, 200) + (text.length > 200 ? '...' : '') : '';
        return `- Stream entry (${rec.createdAt}): ${snippet}`;
      }
      return null;
    })
    .filter(Boolean)
    .join('\n');
}

// ─── Pipeline ───────────────────────────────────────────────────

export async function generateDeck(
  generationContext: DeckGenerationContext,
  opts: { origin?: DeckOrigin } = {},
): Promise<DeckRecord> {
  const db = getDb();
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // ═══════════════════════════════════════════════════════════════
  // Phase 1: Deterministic context (DB queries)
  // ═══════════════════════════════════════════════════════════════

  // The generated daily stack draws only from READY TODO: status = todo, no
  // unresolved blocker, and not snoozed past `now`. In progress work is
  // deliberately excluded here — it belongs in Current Work, not the generated
  // stack (see the Deck/attention contract). Recurrence readiness is the
  // next-occurrence-due check below.
  const nowIso = now.toISOString();
  // SQL PREFILTER — cheap and loose. The authoritative Ready check is the
  // canonical `isReady` predicate applied in JS below, so blocker-resolution
  // (only a Done blocker resolves) and recurrence-due are decided in exactly one
  // place. The SQL still excludes the clear non-candidates, including a
  // future-recurring Todo (recurrence set and its next occurrence not yet due) so
  // it cannot leak through the ordinary Todo query.
  const readyGate = and(
    eq(tasks.status, 'todo'),
    or(isNull(tasks.resurfaceAfter), lte(tasks.resurfaceAfter, nowIso)),
    or(isNull(tasks.recurrence), isNull(tasks.nextRecurrenceAt), lte(tasks.nextRecurrenceAt, nowIso)),
  );

  const activeTasks = db
    .select()
    .from(tasks)
    .where(and(readyGate, isNull(tasks.parentId)))
    .orderBy(sql`${tasks.sortKey} ASC NULLS LAST`, desc(tasks.createdAt))
    .limit(DECK_GENERATION_TASK_LIMIT)
    .all();

  const deadlineTasks = db
    .select()
    .from(tasks)
    .where(and(readyGate, isNotNull(tasks.hardDeadline), lte(tasks.hardDeadline, sevenDaysFromNow)))
    .orderBy(tasks.hardDeadline)
    .all();

  const recurringDue = db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.status, 'todo'),
        isNull(tasks.blockedOn),
        isNotNull(tasks.recurrence),
        lte(tasks.nextRecurrenceAt, todayStr),
      ),
    )
    .all();

  const taskMap = new Map<string, (typeof activeTasks)[number]>();
  for (const t of activeTasks) taskMap.set(t.id, t);
  for (const t of deadlineTasks) taskMap.set(t.id, t);
  for (const t of recurringDue) taskMap.set(t.id, t);

  const candidates = Array.from(taskMap.values());
  // AUTHORITATIVE Ready filter — the single source of truth for eligibility.
  // Resolve each candidate's blocker once (only a Done blocker resolves; an open
  // or archived blocker still blocks), then keep Ready Todo per the canonical
  // predicate. Every downstream deck path derives from this set.
  const blockerIds = candidates.map((t) => t.blockedOn).filter((b): b is string => !!b);
  const blockerStatus = new Map<string, string>();
  if (blockerIds.length > 0) {
    for (const b of db.select({ id: tasks.id, status: tasks.status }).from(tasks).where(inArray(tasks.id, blockerIds)).all()) {
      blockerStatus.set(b.id, b.status);
    }
  }
  const allTasks = candidates.filter((t) =>
    isReady({
      status: normalizeTaskStatus(t.status),
      hasUnresolvedBlocker: !!t.blockedOn && blockerStatus.get(t.blockedOn) !== 'done',
      resurfaceAfter: t.resurfaceAfter ?? null,
      recurrence: t.recurrence ?? null,
      nextRecurrenceAt: t.nextRecurrenceAt ?? null,
      now: nowIso,
    }),
  );

  const parentIds = allTasks.map((t) => t.id);
  const allSubtasks =
    parentIds.length > 0
      ? db
          .select()
          .from(tasks)
          .where(and(inArray(tasks.status, ['todo', 'in_progress', 'consider']), isNotNull(tasks.parentId)))
          .all()
          .filter((s) => s.parentId && taskMap.has(s.parentId))
      : [];

  const completedSubtasks =
    parentIds.length > 0
      ? db
          .select()
          .from(tasks)
          .where(and(eq(tasks.status, 'done'), isNotNull(tasks.parentId)))
          .all()
          .filter((s) => s.parentId && taskMap.has(s.parentId))
      : [];

  const subtasksByParent = new Map<string, { id: string; title: string; completed: boolean }[]>();
  for (const s of [...allSubtasks, ...completedSubtasks]) {
    if (!s.parentId) continue;
    const list = subtasksByParent.get(s.parentId) ?? [];
    list.push({ id: s.id, title: s.title, completed: s.status === 'done' });
    subtasksByParent.set(s.parentId, list);
  }

  const activeAreas = db
    .select()
    .from(areas)
    .where(eq(areas.status, 'active'))
    .orderBy(areas.sortOrder)
    .all();

  const areaMap = new Map(activeAreas.map((a) => [a.id, a.name]));

  const recentCompletions = db
    .select({
      taskTitle: tasks.title,
      completedAt: taskCompletions.completedAt,
      areaId: tasks.areaId,
    })
    .from(taskCompletions)
    .innerJoin(tasks, eq(taskCompletions.taskId, tasks.id))
    .where(gte(taskCompletions.completedAt, fiveDaysAgo))
    .orderBy(desc(taskCompletions.completedAt))
    .limit(20)
    .all();

  // ─── Previous deck — for reconciliation (carry / defer / drop) ───
  // The most recent deck is "what the user was last looking at": yesterday's
  // on the first generation of the day, or today's current version on a
  // same-day regen (which we then supersede). Resolve each prior item's
  // current status so the model can decide carry/defer/drop.
  const previousDeck = getLatestDeck();
  let previousDeckItems: { taskId: string; title: string; status: 'done' | 'active' | 'gone' }[] =
    [];
  if (previousDeck) {
    const prevIds = (previousDeck.items as DeckItem[]).map((i) => i.taskId);
    if (prevIds.length > 0) {
      const rows = db
        .select({ id: tasks.id, title: tasks.title, status: tasks.status })
        .from(tasks)
        .where(inArray(tasks.id, prevIds))
        .all();
      const byId = new Map(rows.map((r) => [r.id, r]));
      previousDeckItems = (previousDeck.items as DeckItem[]).map((it) => {
        const t = byId.get(it.taskId);
        const status: 'done' | 'active' | 'gone' = !t
          ? 'gone'
          : t.status === 'done'
            ? 'done'
            : 'active';
        return { taskId: it.taskId, title: t?.title ?? '(removed task)', status };
      });
    }
  }

  // TODO: Read from user_profile table or USER.md file when implemented
  const userProfile: string | undefined = undefined;

  const parentTitleMap = new Map<string, string>();
  for (const t of allTasks) parentTitleMap.set(t.id, t.title);

  const promptTasks = allTasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    outcome: t.outcome,
    parentId: t.parentId,
    parentTitle: t.parentId ? parentTitleMap.get(t.parentId) : undefined,
    areaName: t.areaId ? areaMap.get(t.areaId) : undefined,
    energy: t.energy,
    effort: t.effort,
    hardDeadline: t.hardDeadline,
    lastProgressAt: t.lastProgressAt,
    timesDeferred: t.timesDeferred,
    blockedOn: t.blockedOn,
    userContext: t.userContext,
    subtasks: subtasksByParent.get(t.id),
  }));

  const promptAreas = activeAreas.map((a) => ({
    id: a.id,
    name: a.name,
    userContext: a.userContext,
    status: a.status,
  }));

  const promptCompletions = recentCompletions.map((c) => ({
    taskTitle: c.taskTitle,
    completedAt: c.completedAt,
    areaName: c.areaId ? areaMap.get(c.areaId) : undefined,
  }));

  // ─── Today's time — sizing context ───
  // Calendar is empty until a connector registers a provider; until then this
  // degrades to "a full workday", and an explicit time budget (context or
  // user_state) still drives sizing.
  const forDate = todayLocalDate();
  const us = getUserState();
  const workdayStart = us?.workdayStart ?? '09:00';
  const workdayEnd = us?.workdayEnd ?? '18:00';
  const calendarBlocks = await getCalendarEventsForDay(forDate);
  const gaps = computeFreeGaps(calendarBlocks, { workdayStart, workdayEnd, date: forDate });
  const calendarMinutes = availableMinutes(gaps);
  const effectiveMinutes = generationContext.availableMinutes ?? us?.availableMinutes ?? calendarMinutes;
  const timeContext = {
    availableMinutes: effectiveMinutes,
    workdayStart,
    workdayEnd,
    hasCalendar: calendarBlocks.length > 0,
    gaps: gaps.map((g) => ({ label: formatGap(g), minutes: g.minutes })),
  };

  // The user's plain-language source instructions (DECK.md), injected so the
  // gathering step knows which connected services to consult and how.
  const deckInstructions = readDeckInstructions() ?? undefined;

  const basePrompt = buildDeckPrompt({
    tasks: promptTasks,
    areas: promptAreas,
    recentCompletions: promptCompletions,
    previousDeckItems,
    timeContext,
    generationContext,
    userProfile,
    deckInstructions,
  });

  // ═══════════════════════════════════════════════════════════════
  // Phase 2: AI context gathering (agentic — KB + calendar + the user's
  // connected, read-only tools, steered by their DECK.md instructions)
  // ═══════════════════════════════════════════════════════════════

  // Deterministic time tool: the model decides WHETHER to consult the calendar
  // (per DECK.md / the default policy), but the free/busy math stays exact.
  // Reuse today's already-fetched blocks; fetch fresh for other dates.
  const get_day_shape = tool({
    description:
      "The user's available work time for a date: busy calendar blocks, free gaps, and total free minutes — already computed. Use for anything about how much time they have; never do free/busy math yourself.",
    inputSchema: z.object({
      date: z.string().optional().describe('YYYY-MM-DD; defaults to today'),
    }),
    execute: async ({ date }) => {
      const d = date || forDate;
      try {
        const blocks = d === forDate ? calendarBlocks : await getCalendarEventsForDay(d);
        const g = d === forDate ? gaps : computeFreeGaps(blocks, { workdayStart, workdayEnd, date: d });
        return {
          date: d,
          workday: `${workdayStart}-${workdayEnd}`,
          calendarConnected: blocks.length > 0,
          busy: blocks.map((b) => ({ start: b.start, end: b.end, title: b.title })),
          freeGaps: g.map(formatGap),
          freeMinutes: availableMinutes(g),
        };
      } catch {
        return { date: d, calendarConnected: false, freeMinutes: null, note: 'calendar unavailable' };
      }
    },
  });

  // Read-only tools for the user's connected services ({} if none connected).
  const connectorTools = await getReadOnlyConnectorTools();

  const contextModel = process.env.MODEL_STANDARD || 'gpt-5.4-mini';

  let gatheredBrief = '';
  let searchContext = '';
  try {
    const contextResult = await generateText({
      model: openai(contextModel),
      system: CONTEXT_GATHERING_PROMPT,
      prompt: basePrompt,
      tools: { searchKnowledgeBase, get_day_shape, ...connectorTools },
      stopWhen: stepCountIs(10),
    });
    gatheredBrief = contextResult.text?.trim() ?? '';
    searchContext = collectSearchResults(contextResult.steps);
  } catch (err) {
    // Gathering is best-effort — a tool/model hiccup must never block the deck.
    console.warn('[deck] context gathering failed, generating without live context', err);
  }

  // ═══════════════════════════════════════════════════════════════
  // Phase 3: Generate deck (structured output, guaranteed)
  // ═══════════════════════════════════════════════════════════════

  // Prefer the model's synthesized brief (it already folds in KB hits, calendar,
  // and any connected sources); fall back to raw KB hits.
  const liveContext = gatheredBrief
    ? `\n\n[Live Context]\nGathered from your connected tools and knowledge base:\n${gatheredBrief}`
    : searchContext
      ? `\n\n[Live Context]\nFrom your notes, stream entries, and related tasks:\n${searchContext}`
      : '';
  const enrichedPrompt = `${basePrompt}${liveContext}`;

  const model = process.env.MODEL_STANDARD || 'gpt-5.4-mini';

  const result = await generateText({
    model: openai(model),
    output: Output.object({ schema: deckResponseSchema }),
    system: DECK_SYSTEM_PROMPT,
    prompt: enrichedPrompt,
  });

  const aiResponse = result.output;
  if (!aiResponse) {
    throw new Error('Deck generation produced no output');
  }

  // ═══════════════════════════════════════════════════════════════
  // Build the change log (carried / deferred / dropped / added)
  // ═══════════════════════════════════════════════════════════════

  // Revalidate + dedupe every model-returned id against the EXACT eligible set
  // (the authoritative Ready Todo tasks) before persistence — the model can
  // hallucinate or repeat an id, and only genuinely-eligible tasks belong in the
  // stack. This also naturally caps the stack at however many are eligible.
  const eligibleIds = new Set(allTasks.map((t) => t.id));
  const usedIds = new Set<string>();
  const deckItems: DeckItem[] = aiResponse.items
    .filter((item) => {
      if (!eligibleIds.has(item.taskId) || usedIds.has(item.taskId)) return false;
      usedIds.add(item.taskId);
      return true;
    })
    .map((item) => ({
      taskId: item.taskId,
      rationale: item.rationale,
      continuityContext: item.continuityContext,
      source: 'ai' as const,
    }));

  // Alternatives are likewise eligible-only and never duplicate a stack item.
  const validatedAlternatives = (aiResponse.alternatives ?? []).filter((alt) => {
    if (!eligibleIds.has(alt.taskId) || usedIds.has(alt.taskId)) return false;
    usedIds.add(alt.taskId);
    return true;
  });

  const prevIdSet = new Set(previousDeckItems.map((p) => p.taskId));
  const newItemIds = new Set(deckItems.map((i) => i.taskId));
  const changes: DeckChange[] = [];

  // Title resolver — denormalize the task title into each change so the UI
  // renders even after a task is completed or deleted.
  const titleById = new Map<string, string>();
  for (const p of previousDeckItems) titleById.set(p.taskId, p.title);
  for (const t of allTasks) titleById.set(t.id, t.title);

  // Reconciliation decisions on the previous deck's items. Trust the deck
  // `items` array as ground truth: don't claim "carried" for something the
  // model left off, or "deferred/dropped" for something it actually kept.
  for (const r of aiResponse.reconciliation ?? []) {
    if (!prevIdSet.has(r.taskId)) continue;
    if (r.decision === 'carry') {
      if (!newItemIds.has(r.taskId)) continue;
      changes.push({
        kind: 'carried',
        taskId: r.taskId,
        title: titleById.get(r.taskId),
        reason: r.reason,
        source: 'reconcile',
      });
    } else {
      if (newItemIds.has(r.taskId)) continue;
      changes.push({
        kind: r.decision === 'defer' ? 'deferred' : 'dropped',
        taskId: r.taskId,
        title: titleById.get(r.taskId),
        reason: r.reason,
        source: 'reconcile',
      });
    }
  }

  // Anything new on today's deck that wasn't on the previous one. Only
  // meaningful when there *was* a previous deck (else everything is "new").
  if (previousDeck) {
    for (const item of deckItems) {
      if (!prevIdSet.has(item.taskId)) {
        changes.push({
          kind: 'added',
          taskId: item.taskId,
          title: titleById.get(item.taskId),
          reason: item.rationale,
          source: 'reconcile',
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Persist as a new active version for today (supersedes the prior one)
  // ═══════════════════════════════════════════════════════════════

  return supersedeAndInsertDeck({
    forDate,
    context: generationContext.context ?? null,
    contextTags: generationContext.contextTags ?? [],
    framing: aiResponse.framing ?? null,
    items: deckItems,
    alternatives: validatedAlternatives,
    searchContext: gatheredBrief || searchContext || null,
    model,
    origin: opts.origin ?? 'manual',
    changes,
    calendarSnapshot: calendarBlocks,
  });
}

import { NextRequest } from 'next/server';
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { getDb } from '@/lib/db';
import { tasks, areas, taskCompletions } from '@/lib/db/schema';
import { eq, and, desc, sql, isNull, isNotNull, gte, lte } from 'drizzle-orm';
import {
  DECK_GENERATION_TASK_LIMIT,
  DECK_SYSTEM_PROMPT,
  deckGenerationContextSchema,
  deckResponseSchema,
  buildDeckPrompt,
} from '@/lib/ai/deck-generation';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const generationContext = deckGenerationContextSchema.parse(body);

    const db = getDb();
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // ─── Query 1: Top active tasks (non-subtasks, not blocked) ───

    const activeTasks = db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.status, 'active'),
          isNull(tasks.parent_id),
          isNull(tasks.blocked_on),
        )
      )
      .orderBy(sql`sort_key ASC NULLS LAST`, desc(tasks.created_at))
      .limit(DECK_GENERATION_TASK_LIMIT)
      .all();

    // ─── Query 2: Deadline tasks (next 7 days, may overlap) ─────

    const deadlineTasks = db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.status, 'active'),
          isNotNull(tasks.hard_deadline),
          lte(tasks.hard_deadline, sevenDaysFromNow),
          isNull(tasks.blocked_on),
        )
      )
      .orderBy(tasks.hard_deadline)
      .all();

    // ─── Query 3: Recurring tasks coming due ────────────────────

    const recurringDue = db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.status, 'active'),
          isNotNull(tasks.recurrence),
          lte(tasks.next_recurrence_at, todayStr),
          isNull(tasks.blocked_on),
        )
      )
      .all();

    // ─── Merge & deduplicate tasks ──────────────────────────────

    const taskMap = new Map<string, typeof activeTasks[number]>();
    for (const t of activeTasks) taskMap.set(t.id, t);
    for (const t of deadlineTasks) taskMap.set(t.id, t);
    for (const t of recurringDue) taskMap.set(t.id, t);

    const allTasks = Array.from(taskMap.values());

    // ─── Fetch subtasks for all parent tasks ────────────────────

    const parentIds = allTasks.map(t => t.id);
    const allSubtasks = parentIds.length > 0
      ? db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.status, 'active'),
              isNotNull(tasks.parent_id),
            )
          )
          .all()
          .filter(s => s.parent_id && taskMap.has(s.parent_id))
      : [];

    // Also include completed subtasks for progress context
    const completedSubtasks = parentIds.length > 0
      ? db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.status, 'done'),
              isNotNull(tasks.parent_id),
            )
          )
          .all()
          .filter(s => s.parent_id && taskMap.has(s.parent_id))
      : [];

    const subtasksByParent = new Map<string, { id: string; title: string; completed: boolean }[]>();
    for (const s of [...allSubtasks, ...completedSubtasks]) {
      if (!s.parent_id) continue;
      const list = subtasksByParent.get(s.parent_id) ?? [];
      list.push({ id: s.id, title: s.title, completed: s.status === 'done' });
      subtasksByParent.set(s.parent_id, list);
    }

    // ─── Query 4: Active areas ──────────────────────────────────

    const activeAreas = db
      .select()
      .from(areas)
      .where(eq(areas.status, 'active'))
      .orderBy(areas.sort_order)
      .all();

    const areaMap = new Map(activeAreas.map(a => [a.id, a.name]));

    // ─── Query 5: Recent completions (last 5 days) ──────────────

    const recentCompletions = db
      .select({
        taskTitle: tasks.title,
        completedAt: taskCompletions.completed_at,
        areaId: tasks.area_id,
      })
      .from(taskCompletions)
      .innerJoin(tasks, eq(taskCompletions.task_id, tasks.id))
      .where(gte(taskCompletions.completed_at, fiveDaysAgo))
      .orderBy(desc(taskCompletions.completed_at))
      .limit(20)
      .all();

    // ─── Query 6: User profile ──────────────────────────────────
    // TODO: Read from user_profile table or USER.md file when implemented
    const userProfile: string | undefined = undefined;

    // ─── Build parent title map ─────────────────────────────────

    const parentTitleMap = new Map<string, string>();
    for (const t of allTasks) {
      parentTitleMap.set(t.id, t.title);
    }

    // ─── Assemble prompt data ───────────────────────────────────

    const promptTasks = allTasks.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      outcome: t.outcome,
      parentId: t.parent_id,
      parentTitle: t.parent_id ? parentTitleMap.get(t.parent_id) : undefined,
      areaName: t.area_id ? areaMap.get(t.area_id) : undefined,
      energy: t.energy,
      effort: t.effort,
      estimatedMinutes: t.estimated_minutes,
      hardDeadline: t.hard_deadline,
      lastProgressAt: t.last_progress_at,
      timesDeferred: t.times_deferred,
      blockedOn: t.blocked_on,
      userContext: t.user_context,
      subtasks: subtasksByParent.get(t.id),
    }));

    const promptAreas = activeAreas.map(a => ({
      name: a.name,
      userContext: a.user_context,
      status: a.status,
    }));

    const promptCompletions = recentCompletions.map(c => ({
      taskTitle: c.taskTitle,
      completedAt: c.completedAt,
      areaName: c.areaId ? areaMap.get(c.areaId) : undefined,
    }));

    const prompt = buildDeckPrompt({
      tasks: promptTasks,
      areas: promptAreas,
      recentCompletions: promptCompletions,
      generationContext,
      userProfile,
    });

    // ─── Call AI ─────────────────────────────────────────────────

    const model = process.env.MODEL_STANDARD || 'gpt-4o';
    const result = await generateObject({
      model: openai(model),
      schema: deckResponseSchema,
      system: DECK_SYSTEM_PROMPT,
      prompt,
    });

    return Response.json(result.object);
  } catch (err) {
    console.error('Deck generation failed:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

import { NextRequest } from 'next/server';
import { Output, generateText, tool, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { uuidv7 } from 'uuidv7';
import { getDb, getRawDb } from '@/lib/db';
import { tasks, areas, taskCompletions, decks } from '@/lib/db/schema';
import type { DeckItem } from '@/lib/db/schema';
import { eq, and, desc, sql, isNull, isNotNull, gte, lte } from 'drizzle-orm';
import { hybridSearch } from '@/lib/embeddings/search';
import {
  DECK_GENERATION_TASK_LIMIT,
  DECK_SYSTEM_PROMPT,
  CONTEXT_GATHERING_PROMPT,
  deckGenerationContextSchema,
  deckResponseSchema,
  buildDeckPrompt,
} from '@/lib/ai/deck-generation';

export const maxDuration = 60;

// ─── Search tool builder ────────────────────────────────────────

function buildSearchTool(rawDb: ReturnType<typeof getRawDb>) {
  return tool({
    description:
      "Search the user's knowledge base — tasks, notes, and stream-of-consciousness entries — using semantic + keyword hybrid search. Returns matching entities with relevance scores.",
    inputSchema: z.object({
      query: z.string().describe('Search query — a topic, keyword, or natural language phrase'),
    }),
    execute: async ({ query }) => {
      try {
        const hits = await hybridSearch(query, { limit: 8 });
        return hits
          .map((hit) => {
            let entity: Record<string, unknown> | undefined;

            if (hit.entityType === 'task') {
              entity = rawDb
                .prepare(
                  'SELECT id, title, description, status, area_id AS areaId, hard_deadline AS hardDeadline, user_context AS userContext FROM tasks WHERE id = ?',
                )
                .get(hit.entityId) as Record<string, unknown> | undefined;
            } else if (hit.entityType === 'note') {
              entity = rawDb
                .prepare('SELECT id, title, body FROM notes WHERE id = ?')
                .get(hit.entityId) as Record<string, unknown> | undefined;
              if (entity?.body && typeof entity.body === 'string' && entity.body.length > 500) {
                entity.body = entity.body.slice(0, 500) + '...';
              }
            } else if (hit.entityType === 'stream') {
              entity = rawDb
                .prepare('SELECT id, raw_text AS rawText, created_at AS createdAt FROM stream WHERE id = ?')
                .get(hit.entityId) as Record<string, unknown> | undefined;
              if (
                entity?.rawText &&
                typeof entity.rawText === 'string' &&
                entity.rawText.length > 500
              ) {
                entity.rawText = entity.rawText.slice(0, 500) + '...';
              }
            }

            if (!entity) return null;
            return { type: hit.entityType, score: hit.score, ...entity };
          })
          .filter(Boolean);
      } catch {
        return [];
      }
    },
  });
}

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
        return `- Task: "${rec.title}"${rec.description ? ` — ${rec.description}` : ''}${rec.userContext ? ` (note: ${rec.userContext})` : ''}`;
      }
      if (type === 'note') {
        const body = rec.body as string | undefined;
        const snippet = body ? ` — ${body.slice(0, 200)}${body.length > 200 ? '...' : ''}` : '';
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

// ─── Route ──────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const generationContext = deckGenerationContextSchema.parse(body);

    const db = getDb();
    const rawDb = getRawDb();
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    // ═══════════════════════════════════════════════════════════════
    // Phase 1: Deterministic context (DB queries)
    // ═══════════════════════════════════════════════════════════════

    const activeTasks = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.status, 'active'), isNull(tasks.parentId), isNull(tasks.blockedOn)))
      .orderBy(sql`${tasks.sortKey} ASC NULLS LAST`, desc(tasks.createdAt))
      .limit(DECK_GENERATION_TASK_LIMIT)
      .all();

    const deadlineTasks = db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.status, 'active'),
          isNotNull(tasks.hardDeadline),
          lte(tasks.hardDeadline, sevenDaysFromNow),
          isNull(tasks.blockedOn),
        ),
      )
      .orderBy(tasks.hardDeadline)
      .all();

    const recurringDue = db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.status, 'active'),
          isNotNull(tasks.recurrence),
          lte(tasks.nextRecurrenceAt, todayStr),
          isNull(tasks.blockedOn),
        ),
      )
      .all();

    const taskMap = new Map<string, (typeof activeTasks)[number]>();
    for (const t of activeTasks) taskMap.set(t.id, t);
    for (const t of deadlineTasks) taskMap.set(t.id, t);
    for (const t of recurringDue) taskMap.set(t.id, t);

    const allTasks = Array.from(taskMap.values());

    const parentIds = allTasks.map((t) => t.id);
    const allSubtasks =
      parentIds.length > 0
        ? db
            .select()
            .from(tasks)
            .where(and(eq(tasks.status, 'active'), isNotNull(tasks.parentId)))
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
      estimatedMinutes: t.estimatedMinutes,
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

    const basePrompt = buildDeckPrompt({
      tasks: promptTasks,
      areas: promptAreas,
      recentCompletions: promptCompletions,
      generationContext,
      userProfile,
    });

    // ═══════════════════════════════════════════════════════════════
    // Phase 2: AI context gathering (tool use — search knowledge base)
    // ═══════════════════════════════════════════════════════════════

    const contextModel = process.env.MODEL_MINI || 'gpt-5.4-nano';

    const contextResult = await generateText({
      model: openai(contextModel),
      system: CONTEXT_GATHERING_PROMPT,
      prompt: basePrompt,
      tools: { searchKnowledgeBase: buildSearchTool(rawDb) },
      stopWhen: stepCountIs(5),
    });

    const searchContext = collectSearchResults(contextResult.steps);

    // ═══════════════════════════════════════════════════════════════
    // Phase 3: Generate deck (structured output, guaranteed)
    // ═══════════════════════════════════════════════════════════════

    const enrichedPrompt = searchContext
      ? `${basePrompt}\n\n[Knowledge Base Context]\nThe following relevant items were found from the user's notes, stream entries, and related tasks:\n${searchContext}`
      : basePrompt;

    const model = process.env.MODEL_STANDARD || 'gpt-5.4-mini';

    const result = await generateText({
      model: openai(model),
      output: Output.object({ schema: deckResponseSchema }),
      system: DECK_SYSTEM_PROMPT,
      prompt: enrichedPrompt,
    });

    const aiResponse = result.output;
    if (!aiResponse) {
      return Response.json({ error: 'No output generated' }, { status: 500 });
    }

    // ═══════════════════════════════════════════════════════════════
    // Persist deck
    // ═══════════════════════════════════════════════════════════════

    const deckItems: DeckItem[] = aiResponse.items.map((item) => ({
      ...item,
      source: 'ai' as const,
    }));

    const deck = db
      .insert(decks)
      .values({
        id: uuidv7(),
        context: generationContext.context ?? null,
        contextTags: generationContext.contextTags ?? [],
        framing: aiResponse.framing ?? null,
        items: deckItems,
        alternatives: aiResponse.alternatives,
        searchContext: searchContext || null,
        model,
      })
      .returning()
      .get();

    return Response.json(deck);
  } catch (err) {
    console.error('[POST /api/deck/generate]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

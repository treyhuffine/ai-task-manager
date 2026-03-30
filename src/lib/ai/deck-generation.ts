import { z } from 'zod';

// ─── Configuration ──────────────────────────────────────────────

/** Number of active tasks to send to the AI for deck generation */
export const DECK_GENERATION_TASK_LIMIT = 50;

/** Max items the AI can put in the primary deck */
const DECK_MAX_ITEMS = 7;
const DECK_MIN_ITEMS = 3;

/** Max alternatives the AI can suggest */
const ALT_MAX_ITEMS = 10;
const ALT_MIN_ITEMS = 3;

// ─── Request schema ─────────────────────────────────────────────

export const deckGenerationContextSchema = z.object({
  context: z.string().optional(),
  contextTags: z.array(z.string()).optional(),
});

export type DeckGenerationContext = z.infer<typeof deckGenerationContextSchema>;

// ─── Response schema (what the AI returns via generateObject) ───

export const deckResponseSchema = z.object({
  dayContext: z.string().nullable().describe(
    'One-line summary of the day shape. Only include if the user context or task landscape meaningfully shapes the day. Null if nothing notable.'
  ),
  items: z.array(z.object({
    taskId: z.string().describe('The task ID from the provided task list'),
    rationale: z.string().describe('One sentence: why this task, why this position in the ranking'),
    continuityContext: z.string().nullable().describe(
      'If the task has recent progress or subtask completion, a brief note like "Last session: got OAuth working, error handling next". Null if not applicable.'
    ),
  })).min(DECK_MIN_ITEMS).max(DECK_MAX_ITEMS).describe(
    'The priority stack — ranked list of tasks to focus on today, most important first'
  ),
  alternatives: z.array(z.object({
    taskId: z.string().describe('The task ID from the provided task list'),
    reason: z.string().describe('Why this task did not make the deck but is worth knowing about'),
  })).min(ALT_MIN_ITEMS).max(ALT_MAX_ITEMS).describe(
    'Tasks the AI considered but ranked lower — good candidates if the user finishes the deck or wants to swap'
  ),
});

export type DeckResponse = z.infer<typeof deckResponseSchema>;

// ─── Context-gathering prompt (Phase 2) ─────────────────────────

export const CONTEXT_GATHERING_PROMPT = `You are a context-gathering step in a task prioritization pipeline for Eon, a personal productivity app. You will receive the user's active tasks, areas, and context for the day.

You have a searchKnowledgeBase tool that searches the user's notes, stream-of-consciousness entries, and tasks using semantic + keyword hybrid search. Use it to find context that would help make better prioritization decisions — notes related to a task's topic, recent stream entries about what the user has been thinking about, or connections between areas.

Search as much or as little as makes sense. If the task list and context are straightforward, you may not need to search at all. If there are ambiguous priorities, rich areas, or user context that hints at deeper threads, search to surface relevant background.`;

// ─── System prompt (Phase 3) ────────────────────────────────────

export const DECK_SYSTEM_PROMPT = `You are the prioritization engine for Eon, a personal productivity app. The user is sitting down to work and needs clarity on what to focus on today.

You will receive their active tasks (roughly pre-ordered by current priority), areas of life/work, recent completions, optional context for today, and optionally additional context surfaced from their knowledge base (notes, stream entries, related tasks).

YOUR JOB: Pick ${DECK_MIN_ITEMS}-${DECK_MAX_ITEMS} tasks for the deck (the priority stack) and ${ALT_MIN_ITEMS}-${ALT_MAX_ITEMS} alternatives. Return task IDs from the provided list — never invent tasks.

RANKING PRINCIPLES:
- Hard deadlines are the strongest signal. Due today/tomorrow = near top. Overdue = top.
- Tasks with recent progress have momentum — they're easier to pick up. Favor continuation.
- User context is king. If they indicate low energy, time constraints, or specific focus, that overrides default ordering.
- The pre-existing sort order reflects the user's general priorities. Respect it unless you have a specific reason to reorder (deadline, momentum, user context today).
- High times_deferred means the user doesn't want to do this right now. Don't push it unless it has an approaching deadline.
- Blocked tasks (blocked_on is set) should NEVER appear in the deck or alternatives.
- Aim for a realistic day. Don't pack 12 hours of work. 5-7 items with a mix of effort sizes.
- Context tags from the user (like "Low energy today") should meaningfully shift your selections — e.g., favor lighter tasks, fewer items.

FOR EACH DECK ITEM: Write a rationale — one sentence explaining why this task and why this position. Reference the user's areas or context when relevant. Be specific, not generic.

FOR ALTERNATIVES: Explain why they didn't make the cut. "Lower priority than today's deadlines" is better than "not as important."

dayContext: If the user's context or the task landscape shapes the day (time constraints, heavy deadlines, energy signals), write one line. Otherwise omit entirely.`;

// ─── Prompt builder ─────────────────────────────────────────────

interface PromptData {
  tasks: {
    id: string;
    title: string;
    description?: string | null;
    outcome?: string | null;
    parentId?: string | null;
    parentTitle?: string;
    areaName?: string;
    energy?: string | null;
    effort?: string | null;
    estimatedMinutes?: number | null;
    hardDeadline?: string | null;
    lastProgressAt?: string | null;
    timesDeferred: number;
    blockedOn?: string | null;
    userContext?: string | null;
    subtasks?: { id: string; title: string; completed: boolean }[];
  }[];
  areas: {
    id: string;
    name: string;
    userContext?: string | null;
    status: string;
  }[];
  recentCompletions: {
    taskTitle: string;
    completedAt: string;
    areaName?: string;
  }[];
  generationContext: DeckGenerationContext;
  userProfile?: string;
}

export function buildDeckPrompt(data: PromptData): string {
  const sections: string[] = [];

  // User profile
  if (data.userProfile) {
    sections.push(`[User Profile]\n${data.userProfile}`);
  }

  // Areas
  if (data.areas.length > 0) {
    const areaLines = data.areas.map(a => {
      const ctx = a.userContext ? ` — "${a.userContext}"` : '';
      return `- [${a.id}] ${a.name}${ctx} (${a.status})`;
    });
    sections.push(`[Areas]\n${areaLines.join('\n')}`);
  }

  // Tasks
  const taskLines = data.tasks.map((t, i) => {
    const parts: string[] = [`${i + 1}. [${t.id}] ${t.title}`];
    const meta: string[] = [];
    if (t.areaName) meta.push(`area: ${t.areaName}`);
    if (t.effort) meta.push(`effort: ${t.effort}`);
    if (t.energy) meta.push(`energy: ${t.energy}`);
    if (t.estimatedMinutes) meta.push(`~${t.estimatedMinutes}m`);
    if (t.hardDeadline) meta.push(`deadline: ${t.hardDeadline}`);
    if (t.lastProgressAt) meta.push(`last progress: ${t.lastProgressAt}`);
    if (t.timesDeferred > 0) meta.push(`deferred: ${t.timesDeferred}x`);
    if (t.blockedOn) meta.push(`BLOCKED: ${t.blockedOn}`);
    if (meta.length > 0) parts.push(`   ${meta.join(' | ')}`);
    if (t.parentTitle) parts.push(`   parent: ${t.parentTitle}`);
    if (t.description) parts.push(`   ${t.description}`);
    if (t.userContext) parts.push(`   user note: ${t.userContext}`);
    if (t.subtasks && t.subtasks.length > 0) {
      const done = t.subtasks.filter(s => s.completed).length;
      const remaining = t.subtasks.filter(s => !s.completed).map(s => s.title);
      parts.push(`   subtasks: ${done}/${t.subtasks.length} done${remaining.length > 0 ? ` (remaining: ${remaining.join(', ')})` : ''}`);
    }
    return parts.join('\n');
  });
  sections.push(`[Active Tasks — roughly ordered by current priority]\n${taskLines.join('\n\n')}`);

  // Recent completions
  if (data.recentCompletions.length > 0) {
    const compLines = data.recentCompletions.map(c => {
      const area = c.areaName ? ` (${c.areaName})` : '';
      return `- "${c.taskTitle}"${area} — completed ${c.completedAt}`;
    });
    sections.push(`[Recent Completions — last 5 days]\n${compLines.join('\n')}`);
  }

  // User context for today
  const contextParts: string[] = [];
  if (data.generationContext.context) {
    contextParts.push(data.generationContext.context);
  }
  if (data.generationContext.contextTags && data.generationContext.contextTags.length > 0) {
    contextParts.push(`Signals: ${data.generationContext.contextTags.join(', ')}`);
  }
  if (contextParts.length > 0) {
    sections.push(`[User Context for Today]\n${contextParts.join('\n')}`);
  }

  return sections.join('\n\n');
}

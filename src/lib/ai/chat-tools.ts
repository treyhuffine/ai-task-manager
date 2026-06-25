/**
 * Tool definitions for the productivity agent chat.
 * Each tool wraps a shared DB query function so the LLM can
 * CRUD tasks, notes, areas, deck, and search the knowledge base.
 */

import { tool } from 'ai';
import { z } from 'zod';
import {
  listTasks, getTask, createTask, updateTask, deleteTask, completeTask,
  listNotes, getNote, createNote, updateNote, deleteNote,
  listAreas, getArea, createArea, updateArea,
  getLatestDeck, updateDeck,
  getUserState, updateUserState,
} from '@/lib/db/queries';
import { hybridSearchWithEntities } from '@/lib/embeddings/search';

// ─── Helpers ──────────────────────────────────────────────────

function toolError(toolName: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[tool:${toolName}]`, message, err);
  return { error: message };
}

/** FK fields where empty strings would cause constraint failures. */
const FK_FIELDS = new Set(['areaId', 'parentId', 'taskId', 'streamItemId']);

/** Strip empty strings on FK fields only — free text fields are left as-is. */
function cleanParams<T extends Record<string, unknown>>(params: T): T {
  const cleaned = { ...params };
  for (const key of FK_FIELDS) {
    if (key in cleaned && cleaned[key] === '') {
      delete cleaned[key];
    }
  }
  return cleaned;
}

// ─── Tasks ────────────────────────────────────────────────────

const taskTools = {
  listTasks: tool({
    description: 'List tasks with optional filters. Use to see what the user has to do, find tasks in a specific area, or check completed work.',
    inputSchema: z.object({
      status: z.union([
        z.enum(['active', 'done', 'archived']),
        z.array(z.enum(['active', 'done', 'archived'])),
      ]).optional().default('active').describe('Filter by status. Can be a single status or array.'),
      areaId: z.string().optional().describe('Filter by area ID (UUID). Call listAreas first to get the ID.'),
      parentId: z.string().optional().describe('Filter by parent task ID to get subtasks'),
      energy: z.enum(['deep', 'light']).optional().describe('Filter by energy level'),
      q: z.string().optional().describe('Search query to filter by title'),
      limit: z.number().optional().default(50).describe('Max results to return'),
    }),
    execute: async (params) => {
      try {
        const tasks = listTasks(params);
        return tasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          description: t.description,
          areaId: t.areaId,
          parentId: t.parentId,
          energy: t.energy,
          effort: t.effort,
          hardDeadline: t.hardDeadline,
          recurrence: t.recurrence,
          blockedOn: t.blockedOn,
          timesDeferred: t.timesDeferred,
          createdAt: t.createdAt,
        }));
      } catch (err) {
        return toolError('listTasks', err);
      }
    },
  }),

  getTask: tool({
    description: 'Get full details of a specific task by ID, including body content.',
    inputSchema: z.object({
      id: z.string().describe('The task ID'),
    }),
    execute: async ({ id }) => {
      try {
        const task = getTask(id);
        if (!task) return { error: 'Task not found' };
        return task;
      } catch (err) {
        return toolError('getTask', err);
      }
    },
  }),

  createTask: tool({
    description: 'Create a new task. Use when the user wants to add a todo, action item, goal, or reminder. IMPORTANT: areaId and parentId must be valid UUIDs. Call listAreas or listTasks first to look up the correct ID. Do NOT pass area names as areaId.',
    inputSchema: z.object({
      title: z.string().describe('Short title for the task'),
      description: z.string().optional().describe('Brief description of what needs to be done'),
      body: z.string().optional().describe('Detailed notes or plan in markdown'),
      areaId: z.string().optional().describe('Area UUID (call listAreas first to get the ID)'),
      parentId: z.string().optional().describe('Parent task UUID if this is a subtask'),
      energy: z.enum(['deep', 'light']).optional().describe('Focus level: deep=concentrated work, light=easy/routine'),
      effort: z.enum(['trivial', 'small', 'medium', 'large', 'epic']).optional().describe('Size estimate'),
      hardDeadline: z.string().optional().describe('Deadline as ISO date string (YYYY-MM-DD)'),
      recurrence: z.string().optional().describe('Recurrence pattern: "daily", "weekly", "monthly", "yearly", or "Xd" (e.g. "3d")'),
      blockedOn: z.string().optional().describe('What this task is blocked on'),
      outcome: z.string().optional().describe('Desired outcome or definition of done'),
      userContext: z.string().optional().describe('Additional context from the user'),
    }),
    execute: async (rawParams) => {
      try {
        const params = cleanParams(rawParams);
        console.log('[tool:createTask] params:', JSON.stringify(params));
        const task = createTask(params);
        return { id: task.id, title: task.title, status: task.status };
      } catch (err) {
        return toolError('createTask', err);
      }
    },
  }),

  updateTask: tool({
    description: 'Update an existing task. Can change any field: title, description, status, energy, effort, deadline, etc.',
    inputSchema: z.object({
      id: z.string().describe('The task ID to update'),
      title: z.string().optional().describe('New title'),
      description: z.string().optional().describe('New description'),
      body: z.string().optional().describe('New body content (markdown)'),
      areaId: z.string().nullish().describe('Area UUID, or null to unset'),
      parentId: z.string().nullish().describe('Parent task UUID, or null to make top-level'),
      status: z.enum(['active', 'done', 'archived']).optional().describe('New status'),
      energy: z.enum(['deep', 'light']).nullish().describe('Energy level'),
      effort: z.enum(['trivial', 'small', 'medium', 'large', 'epic']).nullish().describe('Effort estimate'),
      hardDeadline: z.string().nullish().describe('Deadline (ISO date), or null to clear'),
      recurrence: z.string().nullish().describe('Recurrence pattern, or null to clear'),
      blockedOn: z.string().nullish().describe('What blocks this, or null to unblock'),
      outcome: z.string().nullish().describe('Desired outcome'),
      userContext: z.string().nullish().describe('Additional context'),
      sortKey: z.string().nullish().describe('Sort key for ordering'),
    }),
    execute: async ({ id, ...rawUpdates }) => {
      try {
        const filtered = Object.fromEntries(
          Object.entries(rawUpdates).filter(([, v]) => v !== undefined),
        );
        const updates = cleanParams(filtered);
        console.log('[tool:updateTask] id:', id, 'updates:', JSON.stringify(updates));
        const task = updateTask(id, updates);
        if (!task) return { error: 'Task not found' };
        return { id: task.id, title: task.title, status: task.status, updated: Object.keys(updates) };
      } catch (err) {
        return toolError('updateTask', err);
      }
    },
  }),

  deleteTask: tool({
    description: 'Delete a task permanently. Use with caution. Prefer archiving (updateTask with status: "archived") unless the user explicitly asks to delete.',
    inputSchema: z.object({
      id: z.string().describe('The task ID to delete'),
    }),
    execute: async ({ id }) => {
      try {
        const success = deleteTask(id);
        if (!success) return { error: 'Task not found' };
        return { success: true, deleted_id: id };
      } catch (err) {
        return toolError('deleteTask', err);
      }
    },
  }),

  completeTask: tool({
    description: 'Mark a task as done. For recurring tasks, this logs a completion and bumps the next recurrence date while keeping the task active.',
    inputSchema: z.object({
      id: z.string().describe('The task ID to complete'),
      note: z.string().optional().describe('Optional completion note'),
    }),
    execute: async ({ id, note }) => {
      try {
        const result = completeTask(id, note);
        if (!result) return { error: 'Task not found' };
        return {
          id: result.task.id,
          title: result.task.title,
          recurring: result.recurring,
          nextRecurrenceAt: result.nextRecurrenceAt,
        };
      } catch (err) {
        return toolError('completeTask', err);
      }
    },
  }),
};

// ─── Notes ────────────────────────────────────────────────────

const noteTools = {
  listNotes: tool({
    description: 'List notes with optional filters. Notes are freeform text entries that can be linked to areas or tasks.',
    inputSchema: z.object({
      areaId: z.string().optional().describe('Filter by area UUID'),
      taskId: z.string().optional().describe('Filter by task UUID'),
      status: z.enum(['active', 'archived']).optional().default('active'),
      limit: z.number().optional().default(50),
    }),
    execute: async (params) => {
      try {
        const results = listNotes(params);
        return results.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body?.slice(0, 300) + (n.body && n.body.length > 300 ? '...' : ''),
          areaId: n.areaId,
          taskId: n.taskId,
          status: n.status,
          createdAt: n.createdAt,
        }));
      } catch (err) {
        return toolError('listNotes', err);
      }
    },
  }),

  getNote: tool({
    description: 'Get full details of a specific note by ID, including the complete body.',
    inputSchema: z.object({
      id: z.string().describe('The note ID'),
    }),
    execute: async ({ id }) => {
      try {
        const note = getNote(id);
        if (!note) return { error: 'Note not found' };
        return note;
      } catch (err) {
        return toolError('getNote', err);
      }
    },
  }),

  createNote: tool({
    description: 'Create a new note. Notes are freeform text that can capture ideas, meeting notes, plans, or any information. IMPORTANT: areaId and taskId must be valid UUIDs.',
    inputSchema: z.object({
      body: z.string().describe('Note content in markdown'),
      title: z.string().optional().describe('Optional title'),
      areaId: z.string().optional().describe('Area UUID (call listAreas first)'),
      taskId: z.string().optional().describe('Task UUID (call listTasks first)'),
    }),
    execute: async (rawParams) => {
      try {
        const params = cleanParams(rawParams);
        console.log('[tool:createNote] params:', JSON.stringify(params));
        const note = createNote(params);
        return { id: note.id, title: note.title, status: note.status };
      } catch (err) {
        return toolError('createNote', err);
      }
    },
  }),

  updateNote: tool({
    description: 'Update an existing note. Can change title, body, area, task link, or status.',
    inputSchema: z.object({
      id: z.string().describe('The note ID to update'),
      title: z.string().optional().describe('New title'),
      body: z.string().optional().describe('New body content (markdown)'),
      areaId: z.string().nullish().describe('Area UUID, or null to unset'),
      taskId: z.string().nullish().describe('Task UUID, or null to unset'),
      status: z.enum(['active', 'archived']).optional(),
    }),
    execute: async ({ id, ...rawUpdates }) => {
      try {
        const filtered = Object.fromEntries(
          Object.entries(rawUpdates).filter(([, v]) => v !== undefined),
        );
        const updates = cleanParams(filtered);
        const note = updateNote(id, updates);
        if (!note) return { error: 'Note not found' };
        return { id: note.id, title: note.title, updated: Object.keys(updates) };
      } catch (err) {
        return toolError('updateNote', err);
      }
    },
  }),

  deleteNote: tool({
    description: 'Delete a note permanently.',
    inputSchema: z.object({
      id: z.string().describe('The note ID to delete'),
    }),
    execute: async ({ id }) => {
      try {
        const success = deleteNote(id);
        if (!success) return { error: 'Note not found' };
        return { success: true, deleted_id: id };
      } catch (err) {
        return toolError('deleteNote', err);
      }
    },
  }),
};

// ─── Areas ────────────────────────────────────────────────────

const areaTools = {
  listAreas: tool({
    description: 'List areas (life/work domains like "Work", "Health", "Side Project"). Areas organize tasks and notes. Call this to look up area IDs before creating or filtering tasks/notes.',
    inputSchema: z.object({
      status: z.enum(['active', 'inactive', 'archived', 'all']).optional().default('active'),
    }),
    execute: async (params) => {
      try {
        return listAreas(params);
      } catch (err) {
        return toolError('listAreas', err);
      }
    },
  }),

  getArea: tool({
    description: 'Get full details of a specific area.',
    inputSchema: z.object({
      id: z.string().describe('The area ID'),
    }),
    execute: async ({ id }) => {
      try {
        const area = getArea(id);
        if (!area) return { error: 'Area not found' };
        return area;
      } catch (err) {
        return toolError('getArea', err);
      }
    },
  }),

  createArea: tool({
    description: 'Create a new area/domain for organizing tasks and notes.',
    inputSchema: z.object({
      name: z.string().describe('Area name (e.g. "Work", "Health", "Side Project")'),
      description: z.string().optional().describe('What this area covers'),
      userContext: z.string().optional().describe('User context for AI prioritization'),
    }),
    execute: async (params) => {
      try {
        console.log('[tool:createArea] params:', JSON.stringify(params));
        const area = createArea(params);
        return { id: area.id, name: area.name };
      } catch (err) {
        return toolError('createArea', err);
      }
    },
  }),

  updateArea: tool({
    description: 'Update an existing area.',
    inputSchema: z.object({
      id: z.string().describe('The area ID to update'),
      name: z.string().optional(),
      description: z.string().optional(),
      userContext: z.string().nullish(),
      status: z.enum(['active', 'inactive', 'archived']).optional(),
      sortOrder: z.number().optional(),
    }),
    execute: async ({ id, ...rawUpdates }) => {
      try {
        const filtered = Object.fromEntries(
          Object.entries(rawUpdates).filter(([, v]) => v !== undefined),
        );
        const updates = cleanParams(filtered);
        const area = updateArea(id, updates);
        if (!area) return { error: 'Area not found' };
        return { id: area.id, name: area.name, updated: Object.keys(updates) };
      } catch (err) {
        return toolError('updateArea', err);
      }
    },
  }),
};

// ─── Deck ─────────────────────────────────────────────────────

const deckTools = {
  getDeck: tool({
    description: 'Get the current deck (today\'s priority stack). The deck contains ranked tasks to focus on and alternatives.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const deck = getLatestDeck();
        if (!deck) return { error: 'No deck generated yet' };
        return deck;
      } catch (err) {
        return toolError('getDeck', err);
      }
    },
  }),

  updateDeck: tool({
    description: 'Update the current deck: swap items, reorder, or modify the priority stack.',
    inputSchema: z.object({
      id: z.string().describe('The deck ID to update'),
      items: z.array(z.object({
        taskId: z.string(),
        rationale: z.string(),
        continuityContext: z.string().nullable(),
        source: z.enum(['ai', 'user']),
      })).optional().describe('New ordered list of deck items'),
      alternatives: z.array(z.object({
        taskId: z.string(),
        reason: z.string(),
      })).optional().describe('New alternatives list'),
      framing: z.string().nullish().describe('Day summary framing'),
    }),
    execute: async ({ id, ...rawUpdates }) => {
      try {
        const filtered = Object.fromEntries(
          Object.entries(rawUpdates).filter(([, v]) => v !== undefined),
        );
        const updates = cleanParams(filtered);
        const deck = updateDeck(id, updates);
        if (!deck) return { error: 'Deck not found' };
        return { id: deck.id, itemCount: deck.items.length, updated: Object.keys(updates) };
      } catch (err) {
        return toolError('updateDeck', err);
      }
    },
  }),

  regenerateDeck: tool({
    description: 'Trigger a full deck regeneration. This runs the AI prioritization pipeline to create a new priority stack based on current tasks, deadlines, and context. Use when the user asks to regenerate, refresh, or rebuild their deck.',
    inputSchema: z.object({
      context: z.string().optional().describe('Optional context for today (e.g. "Low energy, only have 2 hours")'),
      contextTags: z.array(z.string()).optional().describe('Signal tags (e.g. ["low-energy", "meetings-heavy"])'),
    }),
    execute: async (params) => {
      try {
        // Direct pipeline call — same process, no HTTP hop. Lazy import:
        // generate-deck pulls in the OpenAI SDK, which the tool registry
        // shouldn't load until a regeneration actually fires.
        const { generateDeck } = await import('@/lib/ai/generate-deck');
        const deck = await generateDeck(params);
        return {
          id: deck.id,
          framing: deck.framing,
          itemCount: deck.items?.length ?? 0,
          items: deck.items,
          alternatives: deck.alternatives,
        };
      } catch (err) {
        return toolError('regenerateDeck', err);
      }
    },
  }),
};

// ─── Search ───────────────────────────────────────────────────

const searchTools = {
  searchKnowledgeBase: tool({
    description: 'Search across all tasks, notes, and stream entries using semantic + keyword hybrid search. Use to find relevant information, answer questions about past work, or locate specific items.',
    inputSchema: z.object({
      query: z.string().describe('Search query: a topic, keyword, or natural language phrase'),
      limit: z.number().optional().default(10).describe('Max results'),
    }),
    execute: async ({ query, limit }) => {
      try {
        return await hybridSearchWithEntities(query, { limit });
      } catch (err) {
        console.error('[tool:searchKnowledgeBase]', err);
        return [];
      }
    },
  }),
};

// ─── User State ───────────────────────────────────────────────

const userStateTools = {
  getUserState: tool({
    description: 'Get the user\'s current state: active area, energy level, available time, and focus context.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const state = getUserState();
        return state ?? { error: 'No user state found' };
      } catch (err) {
        return toolError('getUserState', err);
      }
    },
  }),

  updateUserState: tool({
    description: 'Update the user\'s current state. Use when they tell you about their energy, available time, or want to switch focus areas.',
    inputSchema: z.object({
      activeAreaId: z.string().nullish().describe('Set the active area UUID, or null to clear'),
      activeParentTaskId: z.string().nullish().describe('Set the active parent task UUID, or null to clear'),
      activeEnergy: z.enum(['deep', 'light']).nullish().describe('Current energy level'),
      availableMinutes: z.number().nullish().describe('How many minutes the user has available'),
      description: z.string().optional().describe('Free-text description of current state/focus'),
    }),
    execute: async (params) => {
      try {
        const cleanUpdates = Object.fromEntries(
          Object.entries(params).filter(([, v]) => v !== undefined),
        );
        const state = updateUserState(cleanUpdates);
        return state ?? { error: 'Failed to update user state' };
      } catch (err) {
        return toolError('updateUserState', err);
      }
    },
  }),
};

// ─── Export all tools ─────────────────────────────────────────

export const chatTools = {
  ...taskTools,
  ...noteTools,
  ...areaTools,
  ...deckTools,
  ...searchTools,
  ...userStateTools,
};

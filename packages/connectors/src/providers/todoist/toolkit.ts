/**
 * The `todoist` toolkit — tasks + projects via the Todoist unified v1 API. A non-OAuth provider,
 * so actions carry no `scopes` (they aren't scope-gated; a non-empty scope would wrongly
 * trigger incremental consent on a provider with no OAuth flow).
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';

interface RawTask {
  id?: string;
  content?: string;
  description?: string;
  due?: unknown;
  priority?: number;
  project_id?: string;
  /** REST v2 spelling. */
  is_completed?: boolean;
  /** Unified v1 spelling for the same flag. */
  checked?: boolean;
}

/**
 * v1 list endpoints wrap rows in a cursor envelope (`{ results, next_cursor }`)
 * where v2 returned a bare array. Accept either so a shape change on Todoist's
 * side degrades to an empty list instead of a crash.
 */
function rows<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  const results = (raw as { results?: unknown } | undefined)?.results;
  return Array.isArray(results) ? (results as T[]) : [];
}

function taskSummary(t: RawTask) {
  return {
    id: t.id,
    content: t.content,
    description: t.description,
    due: t.due,
    priority: t.priority,
    project_id: t.project_id,
    is_completed: t.is_completed ?? t.checked,
  };
}

export const todoistToolkit = defineToolkit({
  id: 'todoist',
  providerId: 'todoist',
  displayName: 'Todoist',
  actions: [
    httpAction({
      id: 'todoist.list_tasks',
      description: 'List active tasks, optionally filtered by project or a Todoist filter query.',
      input: z.object({
        project_id: z.string().optional(),
        filter: z.string().optional().describe('Todoist filter, e.g. "today | overdue"'),
      }),
      request: (i) => ({ method: 'GET', path: '/tasks', query: { project_id: i.project_id, filter: i.filter } }),
      output: (raw) => ({ tasks: rows<RawTask>(raw).map(taskSummary) }),
    }),

    httpAction({
      id: 'todoist.create_task',
      description: 'Create a task.',
      mutating: true,
      risk: 'low',
      input: z.object({
        content: z.string(),
        description: z.string().optional(),
        due_string: z.string().optional().describe('Natural language due date, e.g. "tomorrow at 9am"'),
        project_id: z.string().optional(),
        priority: z.number().int().min(1).max(4).optional(),
      }),
      request: (i) => ({
        method: 'POST',
        path: '/tasks',
        body: {
          content: i.content,
          description: i.description,
          due_string: i.due_string,
          project_id: i.project_id,
          priority: i.priority,
        },
      }),
      output: (raw) => taskSummary(raw as RawTask),
    }),

    httpAction({
      id: 'todoist.complete_task',
      description: 'Mark a task complete (close it).',
      mutating: true,
      risk: 'low',
      input: z.object({ id: z.string() }),
      request: (i) => ({ method: 'POST', path: `/tasks/${encodeURIComponent(i.id)}/close` }),
      // The close endpoint returns 204 No Content; surface a stable result regardless.
      output: () => ({ completed: true }),
    }),

    httpAction({
      id: 'todoist.update_task',
      description: 'Update fields on an existing task.',
      mutating: true,
      risk: 'low',
      input: z.object({
        id: z.string(),
        content: z.string().optional(),
        description: z.string().optional(),
        due_string: z.string().optional(),
        priority: z.number().int().min(1).max(4).optional(),
      }),
      request: (i) => ({
        method: 'POST',
        path: `/tasks/${encodeURIComponent(i.id)}`,
        body: { content: i.content, description: i.description, due_string: i.due_string, priority: i.priority },
      }),
      output: () => ({ updated: true }),
    }),

    httpAction({
      id: 'todoist.list_projects',
      description: 'List the user’s projects.',
      input: z.object({}),
      request: () => ({ method: 'GET', path: '/projects' }),
      output: (raw) => ({
        projects: rows<{ id?: string; name?: string }>(raw).map((p) => ({ id: p.id, name: p.name })),
      }),
    }),
  ],
});

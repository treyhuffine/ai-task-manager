/**
 * The `asana` toolkit — tasks, projects, workspaces. Asana wraps every response in `{ data }`
 * (an object for single resources, an array for collections), so every output mapper reads
 * `raw.data`. Non-OAuth provider → no action `scopes` (a PAT carries the user's full access).
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';

/** Unwrap Asana's `{ data }` envelope. */
function data<T>(raw: unknown): T {
  return (raw as { data?: T }).data as T;
}

export const asanaToolkit = defineToolkit({
  id: 'asana',
  providerId: 'asana',
  displayName: 'Asana',
  actions: [
    httpAction({
      id: 'asana.list_workspaces',
      description: 'List the workspaces the user can access.',
      input: z.object({}),
      request: () => ({ method: 'GET', path: '/workspaces' }),
      output: (raw) => ({ workspaces: data(raw) }),
    }),

    httpAction({
      id: 'asana.list_projects',
      description: 'List projects, optionally scoped to a workspace.',
      input: z.object({
        workspace: z.string().optional().describe('Workspace gid to scope to'),
        limit: z.number().int().positive().max(100).default(25),
      }),
      request: (i) => ({ method: 'GET', path: '/projects', query: { workspace: i.workspace, limit: i.limit } }),
      output: (raw) => ({ projects: data(raw) }),
    }),

    httpAction({
      id: 'asana.list_tasks',
      description: 'List tasks. Scope with assignee+workspace, or by project.',
      input: z.object({
        assignee: z.string().optional().describe('Assignee gid (use "me" for the current user)'),
        workspace: z.string().optional().describe('Workspace gid (required with assignee)'),
        project: z.string().optional().describe('Project gid'),
        limit: z.number().int().positive().max(100).default(25),
      }),
      request: (i) => ({
        method: 'GET',
        path: '/tasks',
        query: {
          assignee: i.assignee,
          workspace: i.workspace,
          project: i.project,
          limit: i.limit,
          // Asana returns ONLY gid/name/resource_type unless opt_fields asks
          // for more — without this, every other field reads as undefined.
          opt_fields: 'name,notes,due_on,due_at,completed,modified_at',
        },
      }),
      output: (raw) => ({ tasks: data(raw) }),
    }),

    httpAction({
      id: 'asana.get_task',
      description: 'Get a single task by gid.',
      input: z.object({ gid: z.string() }),
      request: (i) => ({ method: 'GET', path: `/tasks/${encodeURIComponent(i.gid)}` }),
      output: (raw) => data(raw),
    }),

    httpAction({
      id: 'asana.create_task',
      description: 'Create a task in a workspace and/or projects.',
      mutating: true,
      risk: 'low',
      input: z.object({
        name: z.string(),
        notes: z.string().optional(),
        workspace: z.string().optional().describe('Workspace gid'),
        projects: z.array(z.string()).optional().describe('Project gids to add the task to'),
      }),
      request: (i) => ({
        method: 'POST',
        path: '/tasks',
        body: {
          data: {
            name: i.name,
            ...(i.notes !== undefined ? { notes: i.notes } : {}),
            ...(i.workspace !== undefined ? { workspace: i.workspace } : {}),
            ...(i.projects !== undefined ? { projects: i.projects } : {}),
          },
        },
      }),
      output: (raw) => data(raw),
    }),

    httpAction({
      id: 'asana.complete_task',
      description: 'Mark a task complete.',
      mutating: true,
      risk: 'low',
      input: z.object({ gid: z.string() }),
      request: (i) => ({ method: 'PUT', path: `/tasks/${encodeURIComponent(i.gid)}`, body: { data: { completed: true } } }),
      output: () => ({ completed: true }),
    }),
  ],
});

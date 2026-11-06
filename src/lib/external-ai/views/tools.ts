/**
 * Ri's MCP Apps views for outside assistants (docs/mcp-oauth.md, "Views").
 * One HTML resource draws both: `show_deck` for today's deck and `show_tasks`
 * for a list. They are render tools, as MCP Apps and OpenAI recommend: the
 * model still reads data with `get_deck` and `list_tasks`, and calls these
 * when the person should see and act on the result.
 */
import { z } from 'zod';
import type { RiMcpServer } from '@/lib/mcp/http-server';
import { TASKS_VIEW_HTML } from './tasks-view.html';
import { deckView, TASK_VIEW_LIMIT, tasksView, viewSummary, type DeckView, type TasksView } from './data';

export const TASKS_VIEW_URI = 'ui://ri/tasks.html';
export const MCP_APP_MIME = 'text/html;profile=mcp-app';

/**
 * The view reaches nothing on the network: everything it shows and does goes
 * through the host's tool calls. In a chat it opens as a card, and it can fill
 * the screen, which is how the sidebar entry always opens it.
 */
const RESOURCE_META = {
  ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true },
  'openai/ui': { availableDisplayModes: ['inline', 'fullscreen'], preferredDisplayMode: 'inline' },
};

/** The content tools the view itself calls. ChatGPT's Apps SDK layer asks for `widgetAccessible` on them. */
export const VIEW_CALLED_TOOLS: ReadonlySet<string> = new Set(['complete_task', 'transition_task', 'create_task']);
export const VIEW_CALLED_META = { 'openai/widgetAccessible': true };

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

function renderMeta(invoking: string, invoked: string) {
  return {
    ui: { resourceUri: TASKS_VIEW_URI },
    'openai/outputTemplate': TASKS_VIEW_URI,
    'openai/widgetAccessible': true,
    'openai/toolInvocation/invoking': invoking,
    'openai/toolInvocation/invoked': invoked,
  };
}

const taskStatus = z.enum(['consider', 'todo', 'in_progress', 'done', 'archived']);

const showTasksParams = {
  title: z.string().max(80).optional().describe('A short heading for the list, such as "Due this week" or "Added to Ri".'),
  ids: z.array(z.string().min(1)).max(TASK_VIEW_LIMIT).optional().describe('Show exactly these tasks, in this order, all of them. Use it for tasks you just created, found or changed.'),
  status: z.union([taskStatus, z.array(taskStatus)]).optional().describe('Without ids: which statuses to list. Defaults to todo and in_progress.'),
  areaId: z.string().optional().describe('Without ids: only this area’s tasks.'),
  q: z.string().optional().describe('Without ids: only tasks whose text matches.'),
  limit: z.number().int().positive().max(TASK_VIEW_LIMIT).optional().describe(`How many to show, up to ${TASK_VIEW_LIMIT}. Defaults to every named task, or 20.`),
};

function reply(view: DeckView | TasksView) {
  return { content: [{ type: 'text', text: viewSummary(view) }], structuredContent: view as unknown as Record<string, unknown> };
}

export function registerHomeViews(server: RiMcpServer): void {
  server.registerResource('ri-tasks-view', TASKS_VIEW_URI, {
    title: 'Ri tasks',
    description: 'Today’s deck and task lists from Ri, where the person can start and finish tasks.',
    mimeType: MCP_APP_MIME,
    _meta: RESOURCE_META,
  }, () => ({ contents: [{ uri: TASKS_VIEW_URI, mimeType: MCP_APP_MIME, text: TASKS_VIEW_HTML, _meta: RESOURCE_META }] }));

  server.registerTool('show_deck', {
    title: 'Show today’s deck',
    description: 'Show the person today’s deck in an interactive view: their ranked priorities and the hard deadlines due this week, where they can start or finish a task and open it in Ri. Use it when they ask what to work on, what’s on their plate or how today looks. It never makes a new deck. To read the deck yourself, use get_deck.',
    annotations: READ_ONLY,
    _meta: renderMeta('Opening your deck', 'Your deck'),
  }, () => reply(deckView()));

  // A person opens this one, from ChatGPT's sidebar (OpenAI's global entrypoint), so the model never needs it.
  server.registerTool('open_ri', {
    title: 'Ri',
    description: 'Opens Ri as a full-screen app for the person: today’s deck, their tasks and a field to add one. People open it themselves from the app’s sidebar. To show them something in a chat, use show_deck or show_tasks.',
    annotations: READ_ONLY,
    _meta: {
      ...renderMeta('Opening Ri', 'Ri'),
      ui: { resourceUri: TASKS_VIEW_URI, visibility: ['app'] },
      'openai/ui': { entrypoints: [{ type: 'global' }] },
    },
  }, () => reply(deckView()));

  server.registerTool('show_tasks', {
    title: 'Show tasks',
    description: 'Show the person a list of their tasks in an interactive view, where they can start or finish each one and open it in Ri. Pass ids to show particular tasks (ones you just created, found or changed), or filter like list_tasks. Use it when seeing the list helps the person. To read tasks yourself, use list_tasks.',
    inputSchema: showTasksParams,
    annotations: READ_ONLY,
    _meta: renderMeta('Getting your tasks', 'Your tasks'),
  }, args => reply(tasksView(args as z.infer<z.ZodObject<typeof showTasksParams>>)));
}

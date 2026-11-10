/**
 * Ri's MCP Apps views for outside assistants (docs/mcp-oauth.md, "Views").
 * One HTML resource draws them all: `show_deck` for today's deck and
 * `show_tasks` for a list in a chat, and `open_ri` for the whole app (the
 * sidebar and the tab beside a chat). They are render tools, as MCP Apps and
 * OpenAI recommend: the model still reads data with `get_deck` and
 * `list_tasks`, and calls these when the person should see and act on the
 * result. The app's other screens read through `load_view`, which only the
 * view calls.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { RiMcpServer } from '@/lib/mcp/http-server';
import { TASKS_VIEW_HTML } from './tasks-view.html';
import { deckView, mentionItems, noteMarkdown, TASK_VIEW_LIMIT, taskMarkdown, tasksView, viewSummary, type DeckView, type TasksView } from './data';
import { saveScratchpadFromView, SCRATCHPAD_MAX, screenView, VIEW_SCREENS, type ScreenInput } from './screens';

/**
 * The page's address names its contents. ChatGPT treats a view's URI as a
 * cache key ("When you make a breaking change to the HTML, JavaScript, or
 * CSS, publish a new URI", OpenAI's Apps SDK docs), so a page served under
 * an old address can be drawn from an old copy. Each build of the page gets
 * its own address, and tools point at the current one.
 */
export const TASKS_VIEW_URI = `ui://ri/view-${createHash('sha256').update(TASKS_VIEW_HTML).digest('hex').slice(0, 12)}.html`;
/** The address cards drawn before addresses named their page still ask for. It serves the current page. */
export const LEGACY_VIEW_URI = 'ui://ri/tasks.html';
export const MENTION_SEARCH_TOOL = 'search_mentions';

/** What an outside app's connection offers beyond tools: @ items in the person's message box. */
export const HOME_VIEW_EXTENSIONS = { 'openai/mentions': { searchTool: MENTION_SEARCH_TOOL } };
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
export const VIEW_CALLED_TOOLS: ReadonlySet<string> = new Set([
  'complete_task', 'transition_task', 'create_task', 'update_task', 'create_note', 'update_note', 'create_stream_item',
]);
export const VIEW_CALLED_META = { 'openai/widgetAccessible': true };

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
/** Only the view calls it: hosts that follow MCP Apps keep it from their model. */
const VIEW_ONLY = { ui: { visibility: ['app'] }, 'openai/widgetAccessible': true };

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
  server.registerResource('ri-tasks-view-legacy', LEGACY_VIEW_URI, {
    title: 'Ri tasks (earlier cards)',
    description: 'The same view, for cards drawn before the view’s address named its version.',
    mimeType: MCP_APP_MIME,
    _meta: RESOURCE_META,
  }, () => ({ contents: [{ uri: LEGACY_VIEW_URI, mimeType: MCP_APP_MIME, text: TASKS_VIEW_HTML, _meta: RESOURCE_META }] }));

  server.registerTool('show_deck', {
    title: 'Show today’s deck',
    description: 'Show the person today’s deck in an interactive view: their ranked priorities and the hard deadlines due this week, where they can start or finish a task and open it in Ri. Use it when they ask what to work on, what’s on their plate or how today looks. It never makes a new deck. To read the deck yourself, use get_deck.',
    annotations: READ_ONLY,
    _meta: renderMeta('Opening your deck', 'Your deck'),
  }, () => reply(deckView()));

  // A person opens this one from ChatGPT's sidebar (OpenAI's global entrypoint). It stays visible to the
  // model: ChatGPT won't draw the view of a tool hidden from it ("private tools can't render their widgets").
  server.registerTool('open_ri', {
    title: 'Ri',
    description: 'Opens Ri as an app for the person: today’s deck, their tasks, a board, their calendar, notes, search, the Stream and their scratchpad, where they can read and change their work. People usually open it themselves, from the app’s sidebar or beside a chat. To show them something in a chat, use show_deck or show_tasks instead.',
    annotations: READ_ONLY,
    _meta: {
      ...renderMeta('Opening Ri', 'Ri'),
      // Global: the sidebar, full screen. Thread: a tab beside any chat.
      'openai/ui': { entrypoints: [{ type: 'global' }, { type: 'thread' }] },
    },
  }, () => reply({ ...deckView(), app: true }));

  // The app's other screens. The view reads them for the person, and the
  // model never sees what comes back, so it holds no text for one.
  server.registerTool('load_view', {
    title: 'Load a screen of Ri’s view',
    description: 'Only Ri’s own view calls this, to draw its board, calendar, notes, search, one task or note, the Stream and the scratchpad for the person. To read Ri yourself, use search, list_tasks, get_task and get_note.',
    inputSchema: {
      screen: z.enum(VIEW_SCREENS),
      start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      query: z.string().max(200).optional(),
      type: z.enum(['task', 'note']).optional(),
      id: z.string().max(200).optional(),
    },
    annotations: READ_ONLY,
    _meta: VIEW_ONLY,
  }, async args => ({ content: [], structuredContent: await screenView(args as unknown as ScreenInput) as unknown as Record<string, unknown> }));

  server.registerTool('save_scratchpad', {
    title: 'Save the scratchpad',
    description: 'Only Ri’s own view calls this, when the person writes in their scratchpad. base is the text the view last had from Ri, so a change from another device is merged rather than lost.',
    inputSchema: { body: z.string().max(SCRATCHPAD_MAX), base: z.string().max(SCRATCHPAD_MAX) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: VIEW_ONLY,
  }, args => ({ content: [], structuredContent: saveScratchpadFromView(String(args.body), String(args.base)) as unknown as Record<string, unknown> }));

  // The @ menu in the message box (OpenAI's composer at-mentions). It runs on
  // every keystroke, so it only reads, and only the host's app layer calls it.
  server.registerTool(MENTION_SEARCH_TOOL, {
    title: 'Mention a Ri task or note',
    description: 'Finds the person’s tasks and notes by title for the @ menu in their message box. To read or search for yourself, use search, get_task or get_note.',
    inputSchema: { query: z.string().max(200).default('') },
    annotations: READ_ONLY,
    _meta: { ui: { visibility: ['app'] } },
  }, args => ({ content: [], structuredContent: { items: mentionItems(String(args.query ?? '')) } }));

  // What a mentioned item reads as. The host reads each one when the message is sent.
  const missing = (uri: URL, kind: string) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: `This ${kind} isn’t in Ri any more.` }] });
  server.registerResourceTemplate('ri-task', 'ri://task/{id}', { title: 'Ri task', mimeType: 'text/markdown' }, (uri, { id }) => {
    const text = taskMarkdown(String(id));
    return text === null ? missing(uri, 'task') : { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
  });
  server.registerResourceTemplate('ri-note', 'ri://note/{id}', { title: 'Ri note', mimeType: 'text/markdown' }, (uri, { id }) => {
    const text = noteMarkdown(String(id));
    return text === null ? missing(uri, 'note') : { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
  });

  server.registerTool('show_tasks', {
    title: 'Show tasks',
    description: 'Show the person a list of their tasks in an interactive view, where they can start or finish each one and open it in Ri. Pass ids to show particular tasks (ones you just created, found or changed), or filter like list_tasks. Use it when seeing the list helps the person. To read tasks yourself, use list_tasks.',
    inputSchema: showTasksParams,
    annotations: READ_ONLY,
    _meta: renderMeta('Getting your tasks', 'Your tasks'),
  }, args => reply(tasksView(args as z.infer<z.ZodObject<typeof showTasksParams>>)));
}

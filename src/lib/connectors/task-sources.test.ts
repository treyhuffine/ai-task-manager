import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRuntime: vi.fn(),
  listConnections: vi.fn(),
  runAction: vi.fn(),
}));

vi.mock('./runtime', () => ({
  getConnectorRuntime: mocks.getRuntime,
  getConnectorOwnerId: () => 'owner',
}));

import { listConnectorTasks } from './task-sources';

const connection = (providerId: string, id = `${providerId}-account`, fields: Record<string, unknown> = {}) => ({
  id, providerId, ownerId: 'owner', accountId: id, label: id, status: 'active', ...fields,
});
const identity = (toolkitId: string, providerLabel: string, providerId = toolkitId) => ({
  toolkitId, providerLabel, sourceKey: `${toolkitId}:${providerId}-account`,
  connectionId: `${providerId}-account`, accountId: `${providerId}-account`, accountLabel: `${providerId}-account`,
});

const now = new Date('2026-09-28T12:00:00Z');
const task = (id: string, fields: Record<string, unknown> = {}) => ({
  id,
  content: `Task ${id}`,
  description: '',
  projectId: 'project',
  checked: false,
  recurring: false,
  priority: 'p4',
  ...fields,
});
const data = (tasks: unknown[], nextCursor?: string) => ({
  tasks,
  nextCursor,
  totalCount: tasks.length,
  hasMore: Boolean(nextCursor),
  appliedFilters: {},
});
const result = (structuredContent: unknown, fields: Record<string, unknown> = {}) => ({
  ok: true,
  result: {
    server: 'todoist',
    tool: 'find-tasks',
    isError: false,
    content: [{ type: 'text', text: 'Task summary for humans' }],
    structuredContent,
    ...fields,
  },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getRuntime.mockResolvedValue({
    listConnections: mocks.listConnections,
    runAction: mocks.runAction,
  });
  mocks.listConnections.mockResolvedValue([connection('todoist')]);
  mocks.runAction.mockResolvedValue(result(data([])));
});

describe('Todoist task picker over the official MCP server', () => {
  it('keeps prior pages and reports a failure when a later page fails', async () => {
    mocks.runAction.mockResolvedValueOnce(result(data([task('first')], 'next')))
      .mockResolvedValueOnce({ ok: false, reason: 'error', code: 'provider_error', message: 'Unavailable' });
    const out = await listConnectorTasks('');
    expect(out.items[0]?.key).toBe('todoist:todoist-account:first');
    expect(out.sources[0]?.truncated).toBe(true);
    expect(out.failures[0]?.error).toContain('Unavailable');
  });

  it('uses the canonical provider and remote action, retaining chip identity and mapped fields', async () => {
    mocks.runAction.mockResolvedValue(result(data([
      task('stable', { content: '  Ship it  ', description: 'Details', dueDate: '2026-09-29', recurring: 'every Tuesday', priority: 'p1' }),
    ])));
    const out = await listConnectorTasks('', { now });
    expect(mocks.listConnections).toHaveBeenCalledWith({ ownerId: 'owner' });
    expect(mocks.runAction).toHaveBeenCalledExactlyOnceWith('todoist.find-tasks', {
      filter: 'all', responsibleUserFiltering: 'all', limit: 25,
    }, { ownerId: 'owner', connectionId: 'todoist-account', caller: { type: 'app' } });
    expect(out.items).toEqual([{
      key: 'todoist:todoist-account:stable', ...identity('todoist', 'Todoist'),
      title: 'Ship it', subtitle: 'every Tuesday', body: 'Details', sourceUrl: 'https://app.todoist.com/app/task/stable', due: '2026-09-29', priority: 1,
    }]);
    expect(out.sources).toEqual([{ ...identity('todoist', 'Todoist'), truncated: false }]);
    expect(out.failures).toEqual([]);
  });

  it('reports an unavailable canonical tool without trying a retired action name', async () => {
    mocks.runAction.mockResolvedValue({ ok: false, reason: 'error', code: 'unknown_action', message: 'The hosted task tool is unavailable' });
    const out = await listConnectorTasks('');
    expect(out.items).toEqual([]);
    expect(out.failures).toEqual([{ ...identity('todoist', 'Todoist'), error: 'unknown_action: The hosted task tool is unavailable' }]);
    expect(mocks.runAction).toHaveBeenCalledExactlyOnceWith('todoist.find-tasks', {
      filter: 'all', responsibleUserFiltering: 'all', limit: 25,
    }, { ownerId: 'owner', connectionId: 'todoist-account', caller: { type: 'app' } });
  });

  it('follows cursor pages with unchanged parameters and ranks before limiting', async () => {
    const first = Array.from({ length: 100 }, (_, i) => task(`first-${i}`));
    const second = Array.from({ length: 100 }, (_, i) => task(`second-${i}`));
    second[99] = task('urgent', { priority: 'p1', dueDate: '2026-09-27' });
    mocks.runAction
      .mockResolvedValueOnce(result(data(first, 'page-2')))
      .mockResolvedValueOnce(result(data(second)));
    const out = await listConnectorTasks('', { now, limitPerProvider: 150 });
    expect(mocks.runAction.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['todoist.find-tasks', { filter: 'all', responsibleUserFiltering: 'all', limit: 100 }],
      ['todoist.find-tasks', { filter: 'all', responsibleUserFiltering: 'all', limit: 100, cursor: 'page-2' }],
    ]);
    expect(out.items).toHaveLength(150);
    expect(out.items[0]).toMatchObject({ key: 'todoist:todoist-account:urgent', priority: 1, due: '2026-09-27' });
    expect(out.sources[0]?.truncated).toBe(true);
  });

  it('stops after filling the request and preserves a remaining cursor as truncated', async () => {
    mocks.runAction.mockResolvedValue(result(data([task('1'), task('2')], 'more')));
    const out = await listConnectorTasks('', { limitPerProvider: 2 });
    expect(mocks.runAction).toHaveBeenCalledTimes(1);
    expect(out.items).toHaveLength(2);
    expect(out.sources[0]?.truncated).toBe(true);
  });

  it('reports an exactly full last page as exhausted', async () => {
    mocks.runAction.mockResolvedValue(result(data([task('1'), task('2')])));
    const out = await listConnectorTasks('', { limitPerProvider: 2 });
    expect(out.items).toHaveLength(2);
    expect(out.sources[0]?.truncated).toBe(false);
  });

  it('searches on the server and retains local title/body matching', async () => {
    mocks.runAction.mockResolvedValue(result(data([
      task('title', { content: 'Buy Milk' }),
      task('body', { description: 'Milk is needed' }),
      task('unrelated'),
    ])));
    const out = await listConnectorTasks('  Milk  ');
    expect(mocks.runAction.mock.calls[0]?.[1]).toMatchObject({ searchText: 'Milk' });
    expect(out.items.map((item) => item.key).sort()).toEqual(['todoist:todoist-account:body', 'todoist:todoist-account:title']);
  });

  it('prefers structured output to conflicting JSON and prose text', async () => {
    mocks.runAction.mockResolvedValue(result(data([task('structured')]), {
      content: [{ type: 'text', text: JSON.stringify(data([task('text')])) }],
    }));
    expect((await listConnectorTasks('')).items.map((item) => item.key)).toEqual(['todoist:todoist-account:structured']);
  });

  it('falls back to a whole JSON text block while ignoring summaries and unrelated blocks', async () => {
    mocks.runAction.mockResolvedValue(result(undefined, {
      content: [
        { type: 'image', data: 'irrelevant' },
        { type: 'text', text: 'Found 1 task: Task json' },
        { type: 'text', text: '{"message":"not task data"}' },
        { type: 'text', text: JSON.stringify(data([task('json')])) },
      ],
    }));
    const out = await listConnectorTasks('');
    expect(out.items[0]?.key).toBe('todoist:todoist-account:json');
    expect(out.failures).toEqual([]);
  });

  it.each([
    ['missing data', result(undefined)],
    ['malformed structured data', result({ tasks: 'invalid' }, { content: [{ type: 'text', text: JSON.stringify(data([task('fallback')])) }] })],
    ['prose containing JSON', result(undefined, { content: [{ type: 'text', text: `Here are tasks: ${JSON.stringify(data([task('embedded')]))}` }] })],
    ['MCP error', result(data([task('untrusted')]), { isError: true })],
    ['non-object response', { ok: true, result: null }],
    ['invalid cursor type', result({ tasks: [], nextCursor: 42 })],
    ['missing next cursor', result({ tasks: [], hasMore: true })],
    ['first-page sentinel cursor', result({ tasks: [], nextCursor: '0', hasMore: true })],
    ['contradictory pagination', result({ tasks: [], nextCursor: 'more', hasMore: false })],
  ])('reports %s as a provider failure, not a successful empty list', async (_name, response) => {
    mocks.runAction.mockResolvedValue(response);
    const out = await listConnectorTasks('');
    expect(out.items).toEqual([]);
    expect(out.failures).toEqual([{ ...identity('todoist', 'Todoist'), error: expect.any(String) }]);
    expect(out.sources).toHaveLength(1);
  });

  it('deduplicates task IDs across pages and skips completed/deleted/header/invalid rows', async () => {
    mocks.runAction
      .mockResolvedValueOnce(result(data([
        task('1'), task('done', { checked: true }), task('deleted', { isDeleted: true }),
        task('header', { isUncompletable: true }), null, {}, task('', { content: 'No ID' }),
      ], 'page-2')))
      .mockResolvedValueOnce(result(data([task('1', { content: 'Updated title' }), task('2')], 'page-3')))
      .mockResolvedValueOnce(result(data([task('3')])));
    const out = await listConnectorTasks('', { limitPerProvider: 3 });
    expect(mocks.runAction).toHaveBeenCalledTimes(3);
    expect(out.items.map((item) => item.key).sort()).toEqual(['todoist:todoist-account:1', 'todoist:todoist-account:2', 'todoist:todoist-account:3']);
    expect(out.items.find((item) => item.key === 'todoist:todoist-account:1')?.title).toBe('Updated title');
    expect(out.sources[0]?.truncated).toBe(false);
  });

  it('maps all MCP string priorities onto the existing numeric rank', async () => {
    mocks.runAction.mockResolvedValue(result(data([
      task('low', { priority: 'p4' }), task('medium', { priority: 'p3' }),
      task('high', { priority: 'p2' }), task('urgent', { priority: 'p1' }),
      task('unknown', { priority: 4 }),
    ])));
    const out = await listConnectorTasks('', { now });
    expect(Object.fromEntries(out.items.map((item) => [item.key, item.priority]))).toEqual({
      'todoist:todoist-account:low': 0, 'todoist:todoist-account:medium': 1 / 3, 'todoist:todoist-account:high': 2 / 3, 'todoist:todoist-account:urgent': 1, 'todoist:todoist-account:unknown': null,
    });
  });

  it('continues through an empty page and catches a repeated cursor', async () => {
    mocks.runAction.mockResolvedValue(result(data([], 'same')));
    const out = await listConnectorTasks('');
    expect(mocks.runAction).toHaveBeenCalledTimes(2);
    expect(out.failures[0]?.error).toMatch(/did not advance/);
  });

  it('bounds pagination even when cursors keep changing without new tasks', async () => {
    mocks.runAction.mockImplementation(async () => result(data([task('same')], `page-${mocks.runAction.mock.calls.length}`)));
    const out = await listConnectorTasks('');
    expect(mocks.runAction).toHaveBeenCalledTimes(20);
    expect(out.failures[0]?.error).toMatch(/page limit/);
  });

  it('isolates a Todoist transport failure while another connected provider succeeds', async () => {
    mocks.listConnections.mockResolvedValue([connection('todoist'), connection('atlassian')]);
    mocks.runAction.mockImplementation(async (action: string) => {
      if (action === 'todoist.find-tasks') return { ok: false, reason: 'error', code: 'mcp_error', message: 'Connection lost' };
      if (action === 'atlassian.getAccessibleAtlassianResources') return atlassianResult([jiraSite('site')]);
      return atlassianResult(jiraData([jiraIssue('issue')]));
    });
    const out = await listConnectorTasks('');
    expect(out.items[0]?.key).toBe('jira:atlassian-account:site:issue');
    expect(out.failures).toEqual([{ ...identity('todoist', 'Todoist'), error: 'mcp_error: Connection lost' }]);
  });

  it('does not read Todoist when only an unrelated or custom MCP provider is connected', async () => {
    mocks.listConnections.mockResolvedValue([{ providerId: 'mcp.custom-todoist' }, { providerId: 'gmail' }]);
    const out = await listConnectorTasks('');
    expect(mocks.runAction).not.toHaveBeenCalled();
    expect(out.sources).toEqual([]);
    expect(out.supported).toContainEqual({ toolkitId: 'todoist', providerLabel: 'Todoist' });
  });

  it('does not advertise or call retired native adapters when their hosted connectors are connected', async () => {
    const hosted = ['linear', 'notion', 'calendly', 'resend', 'asana'];
    mocks.listConnections.mockResolvedValue(hosted.map((providerId) => ({ providerId })));
    const out = await listConnectorTasks('');
    expect(mocks.runAction).not.toHaveBeenCalled();
    expect(out.sources).toEqual([]);
    expect(out.items).toEqual([]);
    expect(out.failures).toEqual([]);
    expect(out.supported.map((source) => source.toolkitId)).toEqual(['todoist', 'jira']);
  });
});

describe('task picker account isolation', () => {
  it('shows a reconnect failure without attempting reads on an inactive account', async () => {
    mocks.listConnections.mockResolvedValue([connection('todoist', 'expired', { status: 'needs_reauth' })]);
    const out = await listConnectorTasks('');
    expect(mocks.runAction).not.toHaveBeenCalled();
    expect(out.sources[0]?.connectionId).toBe('expired');
    expect(out.failures[0]).toMatchObject({ connectionId: 'expired', error: 'Reconnect this account in Settings' });
  });

  it('reads the same canonical tool separately for every account and keeps colliding task IDs distinct', async () => {
    mocks.listConnections.mockResolvedValue([
      connection('todoist', 'personal', { accountId: 'person', label: 'Personal' }),
      connection('todoist', 'work', { accountId: 'employee', label: 'Work' }),
    ]);
    mocks.runAction.mockImplementation(async (_action, _args, options) => result(data([
      task('same', { content: `Task for ${options.connectionId}` }),
    ])));
    const out = await listConnectorTasks('');
    expect(mocks.runAction.mock.calls.map((call) => call[2].connectionId)).toEqual(['personal', 'work']);
    expect(mocks.runAction.mock.calls.every((call) => call[1].account_id === undefined)).toBe(true);
    expect(out.items.map((item) => [item.key, item.connectionId, item.accountId, item.accountLabel])).toEqual([
      ['todoist:personal:same', 'personal', 'person', 'Personal'],
      ['todoist:work:same', 'work', 'employee', 'Work'],
    ]);
    expect(out.sources.map((source) => source.sourceKey)).toEqual(['todoist:personal', 'todoist:work']);
    expect(out.supported.filter((source) => source.toolkitId === 'todoist')).toHaveLength(1);
  });

  it('keeps an account failure separate from a successful account and its paging state', async () => {
    mocks.listConnections.mockResolvedValue([connection('todoist', 'good'), connection('todoist', 'bad')]);
    mocks.runAction.mockImplementation(async (_action, _args, options) => options.connectionId === 'bad'
      ? { ok: false, reason: 'auth_required' }
      : result(data([task('same')], 'more')));
    const out = await listConnectorTasks('', { limitPerProvider: 1 });
    expect(out.items.map((item) => item.key)).toEqual(['todoist:good:same']);
    expect(out.failures).toEqual([expect.objectContaining({ sourceKey: 'todoist:bad', connectionId: 'bad', error: 'not connected' })]);
    expect(out.sources.map((source) => [source.sourceKey, source.truncated])).toEqual([['todoist:good', true], ['todoist:bad', false]]);
  });

  it('pins Jira site discovery and all subsequent pages to the same account', async () => {
    mocks.listConnections.mockResolvedValue([connection('atlassian', 'a'), connection('atlassian', 'b')]);
    mocks.runAction.mockImplementation(async (action, _args, options) => action.endsWith('getAccessibleAtlassianResources')
      ? atlassianResult([jiraSite('same-site')])
      : atlassianResult(jiraData([jiraIssue('same', { summary: options.connectionId })])));
    const out = await listConnectorTasks('');
    expect(out.items.map((item) => item.key)).toEqual(['jira:a:same-site:same', 'jira:b:same-site:same']);
    for (const account of ['a', 'b']) {
      expect(mocks.runAction.mock.calls.filter((call) => call[2].connectionId === account).map((call) => call[0])).toEqual([
        'atlassian.getAccessibleAtlassianResources', 'atlassian.searchJiraIssuesUsingJql',
      ]);
    }
  });

  it('qualifies keys independently of labels and escapes connection separators', async () => {
    mocks.listConnections.mockResolvedValue([
      connection('todoist', 'a:b', { label: 'Same label' }),
      connection('todoist', 'a', { label: 'Same label' }),
    ]);
    mocks.runAction.mockImplementation(async (_action, _args, options) => result(data([
      task(options.connectionId === 'a' ? 'b:task' : 'task'),
    ])));
    const out = await listConnectorTasks('');
    expect(out.items.map((item) => item.key)).toEqual(['todoist:a%3Ab:task', 'todoist:a:b:task']);
    expect(new Set(out.items.map((item) => item.key)).size).toBe(2);
  });

  it('bounds direct-call limits and keeps provider budgets independent across accounts', async () => {
    mocks.listConnections.mockResolvedValue([connection('todoist', 'one'), connection('todoist', 'two')]);
    mocks.runAction.mockResolvedValue(result(data(Array.from({ length: 250 }, (_, index) => task(String(index))))));
    const out = await listConnectorTasks('', { limitPerProvider: 100000 });
    expect(out.items.filter((item) => item.connectionId === 'one')).toHaveLength(200);
    expect(out.items.filter((item) => item.connectionId === 'two')).toHaveLength(200);
    expect(mocks.runAction.mock.calls.every((call) => call[1].limit === 100)).toBe(true);
  });
});

// Hand-authored contract fixtures, not live account captures. MCP nodes/pageInfo
// follows Atlassian's maintainer example. Resources and fields follow official
// REST documentation, whose MCP passthrough still needs live acceptance.
// Source URLs and that limitation are in docs/connector-audit/atlassian-task-picker.md.
const jiraSite = (id: string, scopes = ['search:jira:agent-interface']) => ({
  id, name: `Site ${id}`, url: `https://${id}.atlassian.net`, scopes,
});
const jiraIssue = (id: string, fields: Record<string, unknown> = {}) => ({
  id, key: `WORK-${id}`, fields: { summary: `Issue ${id}`, status: { name: 'In Progress' }, ...fields },
});
const jiraData = (nodes: unknown[], endCursor: string | null = null) => ({
  issues: { nodes, pageInfo: { hasNextPage: Boolean(endCursor), endCursor } },
});
const atlassianResult = (structuredContent: unknown, extra: Record<string, unknown> = {}) => result(structuredContent, {
  server: 'atlassian', tool: 'searchJiraIssuesUsingJql', ...extra,
});

describe('Jira task picker over the official Atlassian MCP server', () => {
  beforeEach(() => {
    mocks.listConnections.mockResolvedValue([connection('atlassian')]);
    mocks.runAction.mockImplementation(async (action: string) => action === 'atlassian.getAccessibleAtlassianResources'
      ? atlassianResult([jiraSite('site')])
      : atlassianResult(jiraData([])));
  });

  it('uses the shared connection and canonical tools with my open issues as the default', async () => {
    mocks.runAction
      .mockResolvedValueOnce(atlassianResult([jiraSite('site')]))
      .mockResolvedValueOnce(atlassianResult(jiraData([jiraIssue('1', {
        priority: { name: 'Highest' }, duedate: '2026-09-29',
      })])));
    const out = await listConnectorTasks('', { now });
    expect(mocks.runAction.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['atlassian.getAccessibleAtlassianResources', {}],
      ['atlassian.searchJiraIssuesUsingJql', {
        cloudId: 'site',
        jql: 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC',
        fields: ['summary', 'status', 'priority', 'duedate'], maxResults: 25,
      }],
    ]);
    expect(out.items).toEqual([{
      key: 'jira:atlassian-account:site:1', ...identity('jira', 'Jira', 'atlassian'), title: 'WORK-1 Issue 1',
      subtitle: 'In Progress', body: null, sourceUrl: 'https://site.atlassian.net/browse/WORK-1', due: '2026-09-29', priority: 1,
    }]);
    expect(out.sources).toEqual([{ ...identity('jira', 'Jira', 'atlassian'), truncated: false }]);
    expect(out.failures).toEqual([]);
  });

  it('excludes completed status categories and keeps invalid site URLs out of context', async () => {
    mocks.runAction.mockResolvedValueOnce(atlassianResult([{ ...jiraSite('site'), url: 'javascript:alert(1)' }]))
      .mockResolvedValueOnce(atlassianResult(jiraData([
        jiraIssue('done', { status: { name: 'Shipped', statusCategory: { key: 'done' } } }),
        jiraIssue('open'),
      ])));
    const out = await listConnectorTasks('');
    expect(out.items.map((item) => item.key)).toEqual(['jira:atlassian-account:site:open']);
    expect(out.items[0]?.sourceUrl).toBeNull();
  });

  it('searches every Jira site, merges duplicate site grants and keeps colliding issue IDs distinct', async () => {
    mocks.runAction.mockImplementation(async (action: string, args: { cloudId?: string }) => {
      if (action.endsWith('getAccessibleAtlassianResources')) return atlassianResult([
        jiraSite('b'), jiraSite('a', ['read:confluence:agent-interface']), jiraSite('a'),
        jiraSite('a', ['read:jira-work']), jiraSite('docs', ['read:confluence:agent-interface']),
      ]);
      return atlassianResult(jiraData([jiraIssue('same', { summary: `Site ${args.cloudId} work` })]));
    });
    const out = await listConnectorTasks('');
    expect(mocks.runAction.mock.calls.slice(1).map((call) => call[1].cloudId)).toEqual(['a', 'b']);
    expect(out.items.map((item) => item.key).sort()).toEqual(['jira:atlassian-account:a:same', 'jira:atlassian-account:b:same']);
    expect(out.items.map((item) => item.subtitle).sort()).toEqual(['Site a · In Progress', 'Site b · In Progress']);
  });

  it('ranks across sites before limiting even when the first site filled the requested count', async () => {
    mocks.runAction
      .mockResolvedValueOnce(atlassianResult([jiraSite('a'), jiraSite('b')]))
      .mockResolvedValueOnce(atlassianResult(jiraData([jiraIssue('low', { priority: { name: 'Low' } })])))
      .mockResolvedValueOnce(atlassianResult(jiraData([jiraIssue('urgent', { priority: { name: 'Highest' }, duedate: '2026-09-27' })])));
    const out = await listConnectorTasks('', { limitPerProvider: 1, now });
    expect(out.items.map((item) => item.key)).toEqual(['jira:atlassian-account:b:urgent']);
    expect(out.sources[0]?.truncated).toBe(true);
  });

  it('follows per-site cursors, deduplicates pages and sends a bounded page size', async () => {
    mocks.runAction
      .mockResolvedValueOnce(atlassianResult([jiraSite('site')]))
      .mockResolvedValueOnce(atlassianResult(jiraData([jiraIssue('1')], 'second')))
      .mockResolvedValueOnce(atlassianResult(jiraData([jiraIssue('1', { summary: 'Updated' }), jiraIssue('2')], 'third')))
      .mockResolvedValueOnce(atlassianResult(jiraData([jiraIssue('3')])));
    const out = await listConnectorTasks('', { limitPerProvider: 150 });
    expect(mocks.runAction.mock.calls.slice(1).map((call) => call[1])).toEqual([
      expect.objectContaining({ cloudId: 'site', maxResults: 100 }),
      expect.objectContaining({ cloudId: 'site', maxResults: 100, nextPageToken: 'second' }),
      expect.objectContaining({ cloudId: 'site', maxResults: 100, nextPageToken: 'third' }),
    ]);
    expect(out.items).toHaveLength(3);
    expect(out.items.find((item) => item.key === 'jira:atlassian-account:site:1')?.title).toBe('WORK-1 Updated');
    expect(out.sources[0]?.truncated).toBe(false);
  });

  it('stops a site once the limit is filled and marks an unconsumed cursor', async () => {
    mocks.runAction
      .mockResolvedValueOnce(atlassianResult([jiraSite('site')]))
      .mockResolvedValueOnce(atlassianResult(jiraData([jiraIssue('1')], 'more')));
    const out = await listConnectorTasks('', { limitPerProvider: 1 });
    expect(mocks.runAction).toHaveBeenCalledTimes(2);
    expect(out.sources[0]?.truncated).toBe(true);
  });

  it('parses whole JSON text blocks for resources and REST-shaped search data', async () => {
    const textResult = (value: unknown) => atlassianResult(undefined, { content: [
      { type: 'text', text: 'A summary is not data' },
      { type: 'text', text: JSON.stringify(value) },
    ] });
    mocks.runAction
      .mockResolvedValueOnce(textResult([jiraSite('site')]))
      .mockResolvedValueOnce(textResult({ issues: [jiraIssue('1')], isLast: false, nextPageToken: 'next' }))
      .mockResolvedValueOnce(textResult({ issues: [jiraIssue('2')], isLast: true }));
    const out = await listConnectorTasks('');
    expect(out.items.map((item) => item.key).sort()).toEqual(['jira:atlassian-account:site:1', 'jira:atlassian-account:site:2']);
    expect(mocks.runAction.mock.calls[2]?.[1]).toMatchObject({ nextPageToken: 'next' });
    expect(out.failures).toEqual([]);
  });

  it('prefers structured data and normalizes flattened issue fields without interpreting priority IDs', async () => {
    mocks.runAction
      .mockResolvedValueOnce(atlassianResult([jiraSite('site')]))
      .mockResolvedValueOnce(atlassianResult(jiraData([
        { id: '1', key: 'KEY-1', summary: 'Fix it', status: 'Open', priority: 'High', duedate: '2026-10-01' },
        jiraIssue('2', { priority: { id: '1' } }),
      ]), { content: [{ type: 'text', text: JSON.stringify(jiraData([jiraIssue('wrong')])) }] }));
    const out = await listConnectorTasks('');
    expect(out.items.find((item) => item.key === 'jira:atlassian-account:site:1')).toMatchObject({ title: 'KEY-1 Fix it', priority: 0.75, due: '2026-10-01' });
    expect(out.items.find((item) => item.key === 'jira:atlassian-account:site:2')?.priority).toBeNull();
    expect(out.items).toHaveLength(2);
  });

  it('keeps the default JQL inside the query when user text contains quoting or newlines', async () => {
    await listConnectorTasks('term"\\\nOR assignee IS EMPTY');
    expect(mocks.runAction.mock.calls[1]?.[1].jql).toBe(
      'assignee = currentUser() AND statusCategory != Done AND text ~ "termOR assignee IS EMPTY" ORDER BY updated DESC',
    );
  });

  it('keeps server search matches from comments or descriptions absent from the preview', async () => {
    mocks.runAction
      .mockResolvedValueOnce(atlassianResult([jiraSite('site')]))
      .mockResolvedValueOnce(atlassianResult(jiraData([jiraIssue('1', { summary: 'A different title' })])));
    const out = await listConnectorTasks('mentioned-in-a-comment');
    expect(mocks.runAction.mock.calls[1]?.[1].jql).toContain('text ~ "mentioned-in-a-comment"');
    expect(out.items.map((item) => item.key)).toEqual(['jira:atlassian-account:site:1']);
    expect(out.failures).toEqual([]);
  });

  it('shows successful sites alongside named site failures without calling a native fallback', async () => {
    mocks.runAction
      .mockResolvedValueOnce(atlassianResult([jiraSite('a'), jiraSite('b')]))
      .mockResolvedValueOnce(atlassianResult(jiraData([]), { isError: true }))
      .mockResolvedValueOnce(atlassianResult(jiraData([jiraIssue('1')])));
    const out = await listConnectorTasks('');
    expect(out.items.map((item) => item.key)).toEqual(['jira:atlassian-account:b:1']);
    expect(out.failures).toEqual([{ ...identity('jira', 'Jira', 'atlassian'), error: 'Site a: Atlassian could not read Jira data' }]);
    expect(mocks.runAction.mock.calls.every((call) => call[0].startsWith('atlassian.'))).toBe(true);
  });

  it.each([
    ['unknown shape', { items: [] }],
    ['missing structured cursor', { issues: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } } }],
    ['contradictory cursor', { issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: 'more' } } }],
    ['missing pagination', { issues: [] }],
    ['numeric cursor', { issues: [], isLast: false, nextPageToken: 42 }],
    ['invalid last flag', { issues: [], isLast: 'true' }],
    ['dropped remaining rows', { issues: { nodes: [], remainingCount: 5, pageInfo: { hasNextPage: false, endCursor: null } } }],
    ['invalid row', jiraData([null])],
    ['invalid fields', jiraData([{ id: '1', fields: 'text' }])],
  ])('reports %s instead of claiming an empty successful search', async (_name, value) => {
    mocks.runAction
      .mockResolvedValueOnce(atlassianResult([jiraSite('site')]))
      .mockResolvedValueOnce(atlassianResult(value, { content: [{ type: 'text', text: JSON.stringify(jiraData([])) }] }));
    const out = await listConnectorTasks('');
    expect(out.items).toEqual([]);
    expect(out.failures).toEqual([{ ...identity('jira', 'Jira', 'atlassian'), error: expect.stringContaining('Site site:') }]);
  });

  it('detects repeated pagination cursors and retains already read tasks with a visible failure', async () => {
    mocks.runAction.mockImplementation(async (action: string) => action.endsWith('getAccessibleAtlassianResources')
      ? atlassianResult([jiraSite('site')])
      : atlassianResult(jiraData([jiraIssue('same')], 'same-cursor')));
    const out = await listConnectorTasks('');
    expect(mocks.runAction).toHaveBeenCalledTimes(3);
    expect(out.items).toHaveLength(1);
    expect(out.failures[0]?.error).toMatch(/did not advance/);
  });

  it('bounds ever-advancing empty pages', async () => {
    mocks.runAction.mockImplementation(async (action: string) => action.endsWith('getAccessibleAtlassianResources')
      ? atlassianResult([jiraSite('site')])
      : atlassianResult(jiraData([], `page-${mocks.runAction.mock.calls.length}`)));
    const out = await listConnectorTasks('');
    expect(mocks.runAction).toHaveBeenCalledTimes(21);
    expect(out.failures[0]?.error).toMatch(/page limit/);
  });

  it.each([
    ['unknown resource envelope', { sites: [jiraSite('site')] }],
    ['missing scopes', [{ id: 'site' }]],
    ['invalid resource', [null]],
    ['too many sites', Array.from({ length: 21 }, (_, index) => jiraSite(String(index)))],
  ])('reports %s before searching any site', async (_name, value) => {
    mocks.runAction.mockResolvedValueOnce(atlassianResult(value));
    const out = await listConnectorTasks('');
    expect(mocks.runAction).toHaveBeenCalledTimes(1);
    expect(out.failures).toHaveLength(1);
  });

  it('returns an empty Jira source for a valid Confluence-only grant', async () => {
    mocks.runAction.mockResolvedValueOnce(atlassianResult([jiraSite('docs', ['read:confluence:agent-interface'])]));
    const out = await listConnectorTasks('');
    expect(mocks.runAction).toHaveBeenCalledTimes(1);
    expect(out.items).toEqual([]);
    expect(out.failures).toEqual([]);
    expect(out.sources).toEqual([{ ...identity('jira', 'Jira', 'atlassian'), truncated: false }]);
  });

  it('does not read retired Jira credentials or unrelated custom MCP connections', async () => {
    mocks.listConnections.mockResolvedValue([{ providerId: 'jira' }, { providerId: 'mcp.custom-atlassian' }]);
    const out = await listConnectorTasks('');
    expect(mocks.runAction).not.toHaveBeenCalled();
    expect(out.sources).toEqual([]);
    expect(out.supported).toContainEqual({ toolkitId: 'jira', providerLabel: 'Jira' });
  });
});

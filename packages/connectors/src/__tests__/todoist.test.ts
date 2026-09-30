/** Official Todoist MCP tools, ingested through the shared hosted connector path. */
import { describe, it, expect, vi } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { NeedsReauthError } from '../core/errors';
import { ingestMcpServer } from '../mcp/ingest';
import { staticAuthConfigs } from '../auth-configs';
import { inMemoryStore, plaintextSecretBox } from '../testing';
import type { IngestMcpOptions, McpClientLike, McpToolDef } from '../mcp/ingest';

// Discovery fixtures follow Doist/todoist-mcp src/tools on 2026-09-28. Assignment
// and movement are nested update-tasks inputs, not bespoke connector actions.
const strings = (...names: string[]) => Object.fromEntries(names.map((name) => [name, { type: 'string' }]));
const taskFields = {
  ...strings('content', 'description', 'projectId', 'sectionId', 'parentId', 'dueString', 'deadlineDate', 'duration', 'responsibleUser'),
  priority: { type: 'string', enum: ['p1', 'p2', 'p3', 'p4'] },
  labels: { type: 'array', items: { type: 'string' } }, order: { type: 'number' }, isUncompletable: { type: 'boolean' },
};
const tools: McpToolDef[] = [
  {
    name: 'find-tasks', description: 'Find tasks by text, container, assignment or filter.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: { type: 'object', properties: {
      ...strings('searchText', 'projectId', 'sectionId', 'parentId', 'responsibleUser', 'cursor', 'filter', 'filterIdOrName'),
      responsibleUserFiltering: { type: 'string', enum: ['assigned', 'unassignedOrMe', 'all'] },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
      labels: { type: 'array', items: { type: 'string' } }, labelsOperator: { type: 'string', enum: ['and', 'or'] },
    } },
  },
  {
    name: 'add-tasks', description: 'Add tasks.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: { type: 'object', properties: {
      tasks: { type: 'array', minItems: 1, maxItems: 25, items: { type: 'object', properties: taskFields, required: ['content'] } },
    }, required: ['tasks'] },
  },
  {
    name: 'update-tasks', description: 'Update task fields, assignment and container.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: { type: 'object', properties: {
      tasks: { type: 'array', minItems: 1, maxItems: 25, items: { type: 'object', properties: { id: { type: 'string', minLength: 1 }, ...taskFields }, required: ['id'] } },
    }, required: ['tasks'] },
  },
  {
    name: 'complete-tasks', description: 'Complete tasks.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: { type: 'object', properties: { ids: { type: 'array', minItems: 1, items: { type: 'string' } } }, required: ['ids'] },
  },
  {
    name: 'find-projects', description: 'Find projects.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: { type: 'object', properties: {
      ...strings('searchText', 'cursor'), limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      archivedStatus: { type: 'string', enum: ['active', 'archived', 'all'] },
    } },
  },
];
const task = (fields: Record<string, unknown> = {}) => ({
  id: 'task-1', content: 'Review proposal', description: 'Details', dueDate: '2026-10-01', recurring: 'every Thursday', priority: 'p1',
  projectId: 'project-1', sectionId: 'section-1', parentId: 'parent-1', responsibleUid: 'user-1', assignedByUid: 'user-2',
  labels: ['review'], duration: '30m', deadlineDate: '2026-10-02', checked: false, ...fields,
});
const remote = (structuredContent: unknown) => ({ content: [{ type: 'text', text: 'Human-readable summary.' }], structuredContent });
const taskPage = (tasks = [task()], nextCursor?: string) => ({ tasks, nextCursor, hasMore: Boolean(nextCursor), totalCount: tasks.length, appliedFilters: {} });
const updated = () => ({ tasks: [task()], totalCount: 1, updatedTaskIds: ['task-1'], failures: [], appliedOperations: { updateCount: 1, skippedCount: 0, failureCount: 0, redundantMovesSkipped: 0 } });

async function setup(overrides: IngestMcpOptions['toolOverrides'] = {}) {
  const callTool = vi.fn<McpClientLike['callTool']>(async ({ name }) => {
    switch (name) {
      case 'find-tasks': return remote(taskPage());
      case 'add-tasks': return remote({ tasks: [task()], totalCount: 1, failures: [] });
      case 'update-tasks': return remote(updated());
      case 'complete-tasks': return remote({ completed: ['task-1'], failures: [], totalRequested: 1, successCount: 1, failureCount: 0 });
      case 'find-projects': return remote({ projects: [{ id: 'project-1', name: 'Work', viewStyle: 'board' }], hasMore: false, totalCount: 1 });
      default: throw new Error(`Unexpected tool ${name}`);
    }
  });
  const client: McpClientLike = { listTools: vi.fn(async () => ({ tools })), callTool };
  const registry = createRegistry();
  const store = inMemoryStore();
  const secretBox = plaintextSecretBox();
  const registration = await ingestMcpServer(registry, store, secretBox, {
    name: 'todoist', identity: { providerId: 'todoist', displayName: 'Todoist' }, trustToolAnnotations: true,
    client, connectionId: 'todoist-connection', sessionToken: 'session-token', toolOverrides: overrides,
  });
  const fetch = vi.fn<typeof globalThis.fetch>(async () => { throw new Error('Todoist must not make REST requests'); });
  const runtime = createConnectorRuntime({
    registry, store, authRequests: store, secretBox, authConfigs: staticAuthConfigs([]),
    redactor: createRedactor(), approval: { async check() { return 'allow'; } }, fetch,
    authorizationRequired: () => 'https://app.example/connect/todoist',
  });
  return { runtime, registry, store, secretBox, registration, client, callTool, fetch };
}

describe('Todoist official MCP connector', () => {
  it.each([
    ['todoist.find-tasks', {}],
    ['todoist.add-tasks', { tasks: [{ content: 'Task' }] }],
    ['todoist.update-tasks', { tasks: [{ id: 'task-1', content: 'Task' }] }],
    ['todoist.complete-tasks', { ids: ['task-1'] }],
    ['todoist.find-projects', {}],
  ])('preserves the host reconnect outcome for %s', async (actionId, input) => {
    const s = await setup();
    s.callTool.mockRejectedValue(new NeedsReauthError());
    expect(await s.runtime.runAction(actionId as string, input)).toEqual({
      ok: false, reason: 'auth_required', providerId: 'todoist', authorizationUrl: 'https://app.example/connect/todoist',
    });
    expect(s.callTool).toHaveBeenCalledOnce();
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('discovers tools with stable identity and trusted risk metadata', async () => {
    const s = await setup();
    expect(s.registration).toMatchObject({ providerId: 'todoist', toolkitId: 'todoist', connectionId: 'todoist-connection', toolCount: 5 });
    expect(s.registry.getProvider('todoist')?.displayName).toBe('Todoist');
    expect(s.registry.getAction('todoist.find-tasks')?.action).toMatchObject({ mutating: false, risk: 'low' });
    expect(s.registry.getAction('todoist.add-tasks')?.action).toMatchObject({ mutating: true, risk: 'medium' });
    expect(s.registry.getAction('todoist.update-tasks')?.action).toMatchObject({ mutating: true, risk: 'high' });
    expect(s.registry.getAction('todoist.complete-tasks')?.action).toMatchObject({ mutating: true, risk: 'high' });
    expect(await s.runtime.listConnections()).toMatchObject([{ providerId: 'todoist', accountId: 'todoist:default' }]);
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('exposes only discovered tool names and rejects the retired aliases', async () => {
    const s = await setup();
    expect(s.registry.getToolkit('todoist')?.actions.map((action) => action.id)).toEqual(tools.map((tool) => `todoist.${tool.name}`));
    for (const name of ['list_tasks', 'create_task', 'update_task', 'complete_task', 'list_projects']) {
      expect(s.registry.getAction(`todoist.${name}`)).toBeUndefined();
      expect(await s.runtime.runAction(`todoist.${name}`, {})).toMatchObject({ ok: false, code: 'unknown_action' });
    }
    expect(s.callTool).not.toHaveBeenCalled();
  });

  it('does not expose a disabled upstream tool and preserves explicit risk overrides', async () => {
    const disabled = await setup({ 'update-tasks': { enabled: false } });
    expect(disabled.registry.getAction('todoist.update-tasks')).toBeUndefined();
    expect(await disabled.runtime.runAction('todoist.update-tasks', { tasks: [{ id: 'task-1', responsibleUser: 'me' }] })).toMatchObject({ ok: false, code: 'unknown_action' });
    expect(disabled.callTool).not.toHaveBeenCalled();
    const overridden = await setup({ 'update-tasks': { risk: 'medium', mutating: false } });
    expect(overridden.registry.getAction('todoist.update-tasks')?.action).toMatchObject({ risk: 'medium', mutating: false });
  });

  it('forwards self-assignment and project/section/parent moves through the discovered schema', async () => {
    const s = await setup();
    const input = { tasks: [
      { id: 'self', responsibleUser: 'me', sectionId: 'section-2' }, { id: 'project', projectId: 'project-2' },
      { id: 'subtask', parentId: 'parent-2', priority: 'p2', labels: ['next'] }, { id: 'unassigned', responsibleUser: 'unassign' },
    ] };
    expect((await s.runtime.runAction('todoist.update-tasks', input)).ok).toBe(true);
    expect(s.callTool).toHaveBeenCalledExactlyOnceWith({ name: 'update-tasks', arguments: input });
    expect(await s.runtime.runAction('todoist.update-tasks', { tasks: [{ responsibleUser: 'me' }] })).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(s.callTool).toHaveBeenCalledTimes(1);
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('preserves rich task metadata and per-task failures in discovered results', async () => {
    const s = await setup();
    const payload = { ...updated(), failures: [{ item: 'task-2', error: 'Move applied, field update failed', code: 'PARTIAL_MOVE_APPLIED' }] };
    s.callTool.mockResolvedValue(remote(payload));
    expect(await s.runtime.runAction('todoist.update-tasks', { tasks: [{ id: 'task-1', sectionId: 'section-2' }] })).toEqual({
      ok: true, result: { server: 'todoist', tool: 'update-tasks', isError: false, ...remote(payload) },
    });
  });

  it('surfaces an MCP tool error with its diagnostic', async () => {
    const s = await setup();
    s.callTool.mockResolvedValue({ isError: true, content: [{ type: 'text', text: 'User must be a project collaborator' }] });
    expect(await s.runtime.runAction('todoist.update-tasks', { tasks: [{ id: 'task-1', responsibleUser: 'me' }] })).toMatchObject({
      ok: false, reason: 'error', code: 'provider_error', message: expect.stringContaining('project collaborator'),
    });
  });

  it('preserves account metadata and history when migrating an existing native connection', async () => {
    const s = await setup();
    const original = {
      id: 'old-todoist', ownerId: 'owner', providerId: 'todoist', accountId: 'original-account',
      label: 'Personal tasks', email: 'me@example.com', scopes: ['legacy-scope'], status: 'needs_reauth' as const,
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-02T00:00:00Z', lastUsedAt: '2025-01-03T00:00:00Z', config: { imported: true },
    };
    await s.store.save(original, await s.secretBox.seal({ type: 'api_key', apiKey: 'old-token' }));
    await ingestMcpServer(createRegistry(), s.store, s.secretBox, { name: 'todoist', identity: { providerId: 'todoist', displayName: 'Todoist' }, client: s.client, ownerId: 'owner', connectionId: original.id, sessionToken: 'new-token' });
    const saved = await s.store.get(original.id);
    expect(saved?.connection).toMatchObject({ ...original, status: 'active', updatedAt: expect.any(String) });
    expect(saved?.connection.updatedAt).not.toBe(original.updatedAt);
    expect(await s.secretBox.open(saved!.sealed)).toEqual({ type: 'bearer', token: 'new-token' });
  });
});

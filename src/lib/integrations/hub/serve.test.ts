import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import * as q from '@/lib/db/queries';
import type { RiMcpServer, RiMcpToolHandler } from '@/lib/mcp/http-server';
import { serveHub } from './serve';
import { trackAppCall, withStartedBy } from './origin';

const action = (id: string, mutating = false) => ({ id, description: id, input: z.object({ query: z.string().optional() }), mutating });
const runtime = (runAction: (...args: unknown[]) => Promise<unknown>) => ({
  getToolkits: () => [
    { id: 'gmail', providerId: 'google', displayName: 'Gmail', actions: [action('gmail.search_messages'), action('gmail.send_email', true)] },
    { id: 'app_finances', providerId: 'app_finances', displayName: 'Finances', actions: [action('app_finances.list')] },
  ],
  listConnections: async () => [
    { id: 'c-home', providerId: 'google', accountId: 'home', email: 'me@example.com', status: 'active' },
    { id: 'c-work', providerId: 'google', accountId: 'work', email: 'me@work.example', status: 'active' },
    { id: 'c-gone', providerId: 'google', accountId: 'gone', email: 'gone@example.com', status: 'needs_reauth' },
    { id: 'c-fin', providerId: 'app_finances', accountId: 'place:ri', status: 'active' },
  ],
  runAction,
});

function registrar() {
  const tools = new Map<string, { config: Record<string, unknown>; handler: RiMcpToolHandler }>();
  const server = { era: 'modern', registerTool: (name: string, config: Record<string, unknown>, handler: RiMcpToolHandler) => tools.set(name, { config, handler }) } as unknown as RiMcpServer;
  return { server, tools };
}
const context = (meta?: Record<string, unknown>) => ({ signal: new AbortController().signal, headers: undefined, era: 'modern' as const, meta });

describe('the hub surface an app sees', () => {
  it('serves only granted tools, each on the accounts it was granted on, as the app, with every call logged', async () => {
    const app = q.upsertHubApp({
      clientId: `bloom-${crypto.randomUUID()}`, name: 'Bloom', clientUri: 'http://127.0.0.1:4391',
      grant: {
        accounts: [
          { connectionId: 'c-home', toolkitId: 'gmail', tools: ['gmail__search_messages', 'gmail__send_email'] },
          { connectionId: 'c-work', toolkitId: 'gmail', tools: ['gmail__search_messages'] },
          { connectionId: 'c-gone', toolkitId: 'gmail', tools: ['gmail__search_messages'] },
          // Another personal app is never reachable through the hub, whatever a grant says.
          { connectionId: 'c-fin', toolkitId: 'app_finances', tools: ['app_finances__list'] },
        ],
        services: ['list_tasks'],
      },
    });
    const runAction = vi.fn(async () => ({ ok: true, result: { messages: [] } }));
    const { server, tools } = registrar();
    await serveHub(server, runtime(runAction) as never, app, { ownerId: 'local', redirectUris: [] });
    expect([...tools.keys()].sort()).toEqual(['gmail__search_messages', 'gmail__send_email', 'ri__list_tasks']);
    // Search is on two accounts, so the app names one. Send is on one, so there's nothing to choose.
    expect(Object.keys(tools.get('gmail__search_messages')!.config.inputSchema as object)).toContain('account');
    expect(Object.keys(tools.get('gmail__send_email')!.config.inputSchema as object)).not.toContain('account');
    expect(String(tools.get('gmail__send_email')!.config.description)).toContain('asks the person every time');

    await tools.get('gmail__search_messages')!.handler({ query: 'from:clinic', account: 'me@work.example' }, context({ 'app/job': 'import_messages', 'app/jobRun': 'run-7' }));
    expect(runAction).toHaveBeenLastCalledWith('gmail.search_messages', { query: 'from:clinic' }, expect.objectContaining({
      allowedConnectionIds: ['c-home', 'c-work'], account: 'me@work.example',
      caller: { type: 'app', id: `hub:${app.id}`, hubApp: { appId: app.id, startedBy: { kind: 'job', label: 'import_messages', id: 'run-7' } } },
    }));
    // Started while Ri was calling the app for a chat: the approval shows in that chat.
    await withStartedBy({ kind: 'chat', id: 'chat-9' }, () => trackAppCall('http://127.0.0.1:4391/mcp', async () =>
      tools.get('gmail__send_email')!.handler({ query: 'x' }, context())));
    expect(runAction).toHaveBeenLastCalledWith('gmail.send_email', { query: 'x' }, expect.objectContaining({
      connectionId: 'c-home', caller: expect.objectContaining({ hubApp: { appId: app.id, startedBy: { kind: 'chat', id: 'chat-9' } } }),
    }));
    expect(q.listHubCalls(app.id).map(call => [call.tool, call.status, call.startedByKind, call.startedByLabel]).reverse()).toEqual([
      ['gmail__search_messages', 'ok', 'job', 'import_messages'], ['gmail__send_email', 'ok', 'chat', null],
    ]);
  });

  it('answers a write waiting for the person the way the kit retries it', async () => {
    const app = q.upsertHubApp({ clientId: `bloom-${crypto.randomUUID()}`, name: 'Bloom', grant: { accounts: [{ connectionId: 'c-home', toolkitId: 'gmail', tools: ['gmail__send_email'] }], services: [] } });
    const { server, tools } = registrar();
    await serveHub(server, runtime(vi.fn(async () => ({ ok: false, reason: 'approval_required', approvalId: 'a-1' }))) as never, app, { ownerId: 'local', redirectUris: [] });
    const answer = await tools.get('gmail__send_email')!.handler({}, context());
    expect(answer.isError).toBeFalsy();
    expect(JSON.parse((answer.content[0] as { text: string }).text)).toMatchObject({ status: 'approval_required' });
    expect(q.listHubCalls(app.id)[0]).toMatchObject({ status: 'approval_required', startedByKind: 'app' });
  });
});

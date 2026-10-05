import { describe, it, expect } from 'vitest';
import { serveMcp, ingestMcpServer, type McpClientLike, type McpToolResult } from '../mcp';
import { jsonSchemaToZodObject } from '../mcp/json-schema';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { staticOAuthApps } from '../oauth-apps';
import { inMemoryStore, plaintextSecretBox } from '../testing';
import { makeHarness } from './_harness';
import type { ActionOutcome, ApprovalCheckInput, ApprovalDecision, ActionRunEvent } from '../core/types';

interface FakeRegistrar {
  registerTool(name: string, config: { description?: string; inputSchema?: Record<string, unknown> }, handler: (a: Record<string, unknown>) => Promise<McpToolResult>): void;
  tools: Map<string, { config: { inputSchema?: Record<string, unknown> }; handler: (a: Record<string, unknown>) => Promise<McpToolResult> }>;
}
function fakeRegistrar(): FakeRegistrar {
  const tools = new Map<string, { config: { inputSchema?: Record<string, unknown> }; handler: (a: Record<string, unknown>) => Promise<McpToolResult> }>();
  return {
    registerTool(name, config, handler) {
      tools.set(name, { config, handler });
    },
    tools,
  };
}

describe('serveMcp (§11) — project actions to an external host', () => {
  it('registers a sanitized tool per action with an injected account param', async () => {
    const h = makeHarness();
    const reg = fakeRegistrar();
    serveMcp(reg, h.runtime, { redactor: h.redactor });
    expect(reg.tools.has('gmail__send_email')).toBe(true);
    expect(reg.tools.get('gmail__send_email')?.config.inputSchema).toHaveProperty('account');
  });

  it('runs a connected action through the same gates and returns content', async () => {
    const h = makeHarness();
    await h.connect();
    h.env.action = () => ({ json: { items: [{ id: 'primary', summary: 'Primary', primary: true }] } });
    const reg = fakeRegistrar();
    serveMcp(reg, h.runtime, { redactor: h.redactor });
    const res = await reg.tools.get('google_calendar__list_calendars')!.handler({});
    const payload = JSON.parse(res.content[0]!.text);
    expect(payload.calendars).toHaveLength(1);
    expect(res.isError).toBeUndefined();
  });

  it('returns a model-safe authorization_required (no URL) and notifies the host on a missing connection', async () => {
    const h = makeHarness();
    const paused: { actionId: string; outcome: ActionOutcome }[] = [];
    const reg = fakeRegistrar();
    serveMcp(reg, h.runtime, { onPause: (actionId, outcome) => paused.push({ actionId, outcome }) });
    const res = await reg.tools.get('google_calendar__list_calendars')!.handler({});
    const payload = JSON.parse(res.content[0]!.text);
    expect(payload.status).toBe('authorization_required');
    expect(res.content[0]!.text).not.toContain('accounts.google.com'); // URL not exposed to the client
    expect(paused[0]?.outcome).toMatchObject({ reason: 'auth_required' });
    expect((paused[0]?.outcome as { authorizationUrl: string }).authorizationUrl).toContain('accounts.google.com');
  });

  it('connectionPins hard-pins a toolkit to one connection and drops the account param (§6a)', async () => {
    const h = makeHarness();
    await h.connect();
    const conns = await h.runtime.listConnections();
    const id = conns[0]!.id;
    h.env.action = () => ({ json: { items: [{ id: 'primary', summary: 'Primary', primary: true }] } });

    const reg = fakeRegistrar();
    serveMcp(reg, h.runtime, { redactor: h.redactor, connectionPins: { google_calendar: id } });
    const tool = reg.tools.get('google_calendar__list_calendars')!;
    expect(tool.config.inputSchema).not.toHaveProperty('account'); // pinned → no account choice exposed
    const res = await tool.handler({});
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0]!.text).calendars).toHaveLength(1);

    // Pinned to a connection that doesn't exist → fails closed (never silently resolves elsewhere).
    const reg2 = fakeRegistrar();
    serveMcp(reg2, h.runtime, { connectionPins: { google_calendar: 'does-not-exist' } });
    const out = await reg2.tools.get('google_calendar__list_calendars')!.handler({});
    expect(JSON.parse(out.content[0]!.text).calendars).toBeUndefined();
  });
});

describe('serveMcp allowedAccounts: a toolkit scoped to a subset of accounts', () => {
  async function threeAccounts() {
    const h = makeHarness();
    const personal = await h.connect({ email: 'personal@gmail.com' });
    const work = await h.connect({ email: 'work@gmail.com' });
    const side = await h.connect({ email: 'side@gmail.com' });
    h.env.action = () => ({ json: { items: [{ id: 'primary', summary: 'Primary', primary: true }] } });
    const choices = await h.runtime.listAccountChoices('google');
    const pick = (...ids: string[]) => choices.filter((c) => ids.includes(c.connectionId));
    return { h, personal, work, side, pick };
  }
  const describeOf = (schema: Record<string, unknown> | undefined, key: string): string | undefined =>
    (schema?.[key] as { description?: string } | undefined)?.description;
  const ranAs = (h: ReturnType<typeof makeHarness>) =>
    [...h.runs].reverse().find((e) => e.phase === 'finish' && e.status === 'ok')?.connectionId;

  it('keeps the account param, described with exactly the allowed accounts', async () => {
    const { h, work, side, pick } = await threeAccounts();
    const reg = fakeRegistrar();
    serveMcp(reg, h.runtime, { allowedAccounts: { google_calendar: pick(work.id, side.id) } });
    const schema = reg.tools.get('google_calendar__list_calendars')!.config.inputSchema;
    expect(schema).toHaveProperty('account');
    const desc = describeOf(schema, 'account')!;
    expect(desc).toContain('"work@gmail.com"');
    expect(desc).toContain('"side@gmail.com"');
    expect(desc).not.toContain('personal@gmail.com');
    // Other toolkits are untouched: the generic param, no subset.
    expect(describeOf(reg.tools.get('gmail__search_messages')!.config.inputSchema, 'account')).not.toContain('allowed here');
  });

  it('runs an account inside the subset', async () => {
    const { h, work, side, pick } = await threeAccounts();
    const reg = fakeRegistrar();
    serveMcp(reg, h.runtime, { allowedAccounts: { google_calendar: pick(work.id, side.id) } });
    const res = await reg.tools.get('google_calendar__list_calendars')!.handler({ account: 'side@gmail.com' });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0]!.text).calendars).toHaveLength(1);
    expect(ranAs(h)).toBe(side.id);
  });

  it('rejects an account outside the subset with a model-safe error listing the allowed ones', async () => {
    const { h, personal, work, side, pick } = await threeAccounts();
    const paused: ActionOutcome[] = [];
    const reg = fakeRegistrar();
    serveMcp(reg, h.runtime, {
      allowedAccounts: { google_calendar: pick(work.id, side.id) },
      onPause: (_id, o) => paused.push(o),
    });
    const res = await reg.tools.get('google_calendar__list_calendars')!.handler({ account: 'personal@gmail.com' });
    expect(res.isError).toBe(true);
    const payload = JSON.parse(res.content[0]!.text);
    expect(payload).toMatchObject({ status: 'error', code: 'account_not_allowed' });
    expect(payload.message).toContain('"work@gmail.com"');
    expect(payload.message).toContain('"side@gmail.com"');
    expect(res.content[0]!.text).not.toContain(personal.id);
    expect(ranAs(h)).toBeUndefined();
    expect(paused[0]).toMatchObject({ reason: 'error', code: 'account_not_allowed' });
  });

  it('with no account given, asks to choose among the subset only', async () => {
    const { h, work, side, pick } = await threeAccounts();
    const reg = fakeRegistrar();
    serveMcp(reg, h.runtime, { allowedAccounts: { google_calendar: pick(work.id, side.id) } });
    const res = await reg.tools.get('google_calendar__list_calendars')!.handler({});
    const payload = JSON.parse(res.content[0]!.text);
    expect(payload.status).toBe('choose_account');
    expect(payload.accounts.sort()).toEqual(['side@gmail.com', 'work@gmail.com']);
  });

  it('a one-account set behaves exactly like a pin (param hidden, hint ignored)', async () => {
    const { h, work, pick } = await threeAccounts();
    const reg = fakeRegistrar();
    serveMcp(reg, h.runtime, { allowedAccounts: { google_calendar: pick(work.id) } });
    const tool = reg.tools.get('google_calendar__list_calendars')!;
    expect(tool.config.inputSchema).not.toHaveProperty('account');
    const res = await tool.handler({ account: 'personal@gmail.com' });
    expect(res.isError).toBeUndefined();
    expect(ranAs(h)).toBe(work.id);
  });

  it('an empty set exposes no tools for that toolkit (fail closed)', async () => {
    const { h } = await threeAccounts();
    const reg = fakeRegistrar();
    serveMcp(reg, h.runtime, { toolkits: ['google_calendar', 'gmail'], allowedAccounts: { google_calendar: [] } });
    expect(reg.tools.has('google_calendar__list_calendars')).toBe(false);
    expect(reg.tools.has('gmail__search_messages')).toBe(true);
  });

  it('a pin for the same toolkit wins over a set', async () => {
    const { h, personal, work, side, pick } = await threeAccounts();
    const reg = fakeRegistrar();
    serveMcp(reg, h.runtime, {
      connectionPins: { google_calendar: personal.id },
      allowedAccounts: { google_calendar: pick(work.id, side.id) },
    });
    const tool = reg.tools.get('google_calendar__list_calendars')!;
    expect(tool.config.inputSchema).not.toHaveProperty('account');
    await tool.handler({});
    expect(ranAs(h)).toBe(personal.id);
  });
});

// ── Ingestion ────────────────────────────────────────────────────────────────

function ingestSetup() {
  const registry = createRegistry();
  const store = inMemoryStore();
  const secretBox = plaintextSecretBox();
  const redactor = createRedactor();
  const runs: ActionRunEvent[] = [];
  let decide: (i: ApprovalCheckInput) => ApprovalDecision = (i) => (i.mutating ? 'ask' : 'allow');
  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    secretBox,
    oauthApps: staticOAuthApps({}),
    approval: { async check(i) { return decide(i); } },
    redactor,
    onActionRun: (e) => runs.push(e),
  });
  return { registry, store, secretBox, redactor, runtime, runs, setApproval: (d: typeof decide) => { decide = d; } };
}

const demoClient = (calls: { name: string; arguments?: Record<string, unknown> }[], contentFor?: (name: string, args?: Record<string, unknown>) => unknown): McpClientLike => ({
  async listTools() {
    return { tools: [{ name: 'echo', description: 'Echo input' }, { name: 'write_thing', description: 'Write a thing' }] };
  },
  async callTool(params) {
    calls.push(params);
    return { content: contentFor ? contentFor(params.name, params.arguments) : [{ type: 'text', text: `ran ${params.name}` }] };
  },
});

describe('ingestMcpServer (§12) — external MCP as a gated provider', () => {
  it('captures original UI metadata through the runtime without adding it to model results or audit', async () => {
    const s = ingestSetup(); const captured: unknown[] = [];
    const original = { content: [{ type: 'text', text: 'Visible summary' }], structuredContent: { rows: [1] }, _meta: { privateUi: 'private widget payload' } };
    await ingestMcpServer(s.registry, s.store, s.secretBox, { name: 'view', client: {
      listTools: async () => ({ tools: [{ name: 'query', _meta: { ui: { resourceUri: 'ui://query' } } }] }), callTool: async () => original,
    } });
    await s.runtime.runAction('mcp.view.query', {}, { captureOriginalResult: result => captured.push(result) });
    expect(captured).toHaveLength(0);
    s.setApproval(() => 'allow');
    const result = await s.runtime.runAction('mcp.view.query', {}, { captureOriginalResult: value => captured.push(value) });
    expect(captured).toEqual([original]); expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private widget payload');
    expect(JSON.stringify(s.runs)).not.toContain('private widget payload');
  });
  it('keeps app-only tools out of model projections and enforces tool audience before execution', async () => {
    const s = ingestSetup(); let executions = 0;
    await ingestMcpServer(s.registry, s.store, s.secretBox, { name: 'view', client: {
      listTools: async () => ({ tools: [{ name: 'widget_update', _meta: { ui: { visibility: ['app'] } } }, { name: 'query', _meta: { ui: { visibility: ['model'] } } }] }),
      callTool: async () => { executions++; return { content: [{ type: 'text', text: 'Done' }] }; },
    } });
    const reg = fakeRegistrar(); serveMcp(reg, s.runtime);
    expect([...reg.tools.keys()]).toEqual(['mcp__view__query']);
    s.setApproval(() => 'allow');
    expect(await s.runtime.runAction('mcp.view.widget_update', {})).toMatchObject({ ok: false });
    expect(await s.runtime.runAction('mcp.view.query', {}, { toolAudience: 'app' })).toMatchObject({ ok: false });
    expect(executions).toBe(0);
    expect(await s.runtime.runAction('mcp.view.widget_update', {}, { toolAudience: 'app' })).toMatchObject({ ok: true });
    expect(executions).toBe(1);
  });
  it('registers namespaced, provenance-clean actions', async () => {
    const s = ingestSetup();
    const res = await ingestMcpServer(s.registry, s.store, s.secretBox, { name: 'demo', client: demoClient([]) });
    expect(res.providerId).toBe('mcp_demo');
    expect(res.toolCount).toBe(2);
    expect(s.registry.getAction('mcp.demo.echo')).toBeTruthy();
    expect(s.registry.getAction('mcp.demo.write_thing')).toBeTruthy();
  });

  it('defaults to mutating/high-risk → hits the approval gate by default', async () => {
    const s = ingestSetup();
    await ingestMcpServer(s.registry, s.store, s.secretBox, { name: 'demo', client: demoClient([]) });
    const out = await s.runtime.runAction('mcp.demo.echo', { x: 1 });
    expect(out).toMatchObject({ ok: false, reason: 'approval_required', risk: 'high' });
  });

  it('on approval, executes and returns a provenance-tagged result', async () => {
    const s = ingestSetup();
    const calls: { name: string; arguments?: Record<string, unknown> }[] = [];
    await ingestMcpServer(s.registry, s.store, s.secretBox, { name: 'demo', client: demoClient(calls) });
    s.setApproval(() => 'allow');
    const out = await s.runtime.runAction('mcp.demo.echo', { hello: 'world' });
    expect(out.ok).toBe(true);
    expect((out as { result: { server: string; tool: string } }).result).toMatchObject({ server: 'demo', tool: 'echo' });
    expect(calls[0]).toMatchObject({ name: 'echo', arguments: { hello: 'world' } });
  });

  it('redacts our secrets out of ingested output in the audit preview', async () => {
    const s = ingestSetup();
    s.redactor.register('SEKRET-INGEST-9', 'sentinel');
    await ingestMcpServer(s.registry, s.store, s.secretBox, {
      name: 'demo',
      client: demoClient([], () => [{ type: 'text', text: 'leaked SEKRET-INGEST-9 in output' }]),
    });
    s.setApproval(() => 'allow');
    s.runs.length = 0;
    await s.runtime.runAction('mcp.demo.echo', {});
    expect(JSON.stringify(s.runs)).not.toContain('SEKRET-INGEST-9');
  });

  it('re-ingest with a stable connectionId upserts one connection (no boot duplication)', async () => {
    const s = ingestSetup();
    await ingestMcpServer(s.registry, s.store, s.secretBox, {
      name: 'demo',
      client: demoClient([]),
      connectionId: 'mcp-demo',
    });
    // A fresh registry simulates a reboot (the engine registry is append-only; the
    // host rebuilds it each boot and re-ingests). The connection store persists.
    const registry2 = createRegistry();
    const r2 = await ingestMcpServer(registry2, s.store, s.secretBox, {
      name: 'demo',
      client: demoClient([]),
      connectionId: 'mcp-demo',
    });
    expect(r2.connectionId).toBe('mcp-demo');
    const conns = (await s.store.list({})).filter((c) => c.providerId === 'mcp_demo');
    expect(conns).toHaveLength(1);
  });

  it('preserves the tool input schema so the model gets typed args (§12)', async () => {
    const s = ingestSetup();
    const schemaClient: McpClientLike = {
      async listTools() {
        return {
          tools: [
            {
              name: 'read',
              description: 'Read',
              inputSchema: {
                type: 'object',
                properties: { repoName: { type: 'string', description: 'owner/repo' }, depth: { type: 'number' } },
                required: ['repoName'],
              },
            },
          ],
        };
      },
      async callTool() {
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    };
    await ingestMcpServer(s.registry, s.store, s.secretBox, { name: 'demo', client: schemaClient });
    const reg = fakeRegistrar();
    serveMcp(reg, s.runtime, {});
    const tool = reg.tools.get('mcp__demo__read');
    expect(tool).toBeTruthy();
    expect(tool!.config.inputSchema).toHaveProperty('repoName');
    expect(tool!.config.inputSchema).toHaveProperty('depth');
    expect(tool!.config.inputSchema).toHaveProperty('account'); // serveMcp still injects account
  });

  it('per-tool overrides: disabled tool is hidden, non-mutating tool reads through the gate (§12)', async () => {
    const s = ingestSetup();
    const res = await ingestMcpServer(s.registry, s.store, s.secretBox, {
      name: 'demo',
      client: demoClient([]),
      toolOverrides: { write_thing: { enabled: false }, echo: { mutating: false } },
    });
    expect(res.toolCount).toBe(1); // write_thing not ingested
    expect(s.registry.getAction('mcp.demo.write_thing')).toBeFalsy();
    expect(res.tools.map((t) => t.name).sort()).toEqual(['echo', 'write_thing']); // full list still reported
    const out = await s.runtime.runAction('mcp.demo.echo', {}); // non-mutating → no approval
    expect(out.ok).toBe(true);
  });

  it('lets an official MCP provider retain its canonical identity and account bindings', async () => {
    const s = ingestSetup();
    const res = await ingestMcpServer(s.registry, s.store, s.secretBox, {
      name: 'todoist-official',
      client: demoClient([]),
      identity: { providerId: 'todoist', displayName: 'Todoist' },
      connectionId: 'todoist-existing-connection',
    });
    expect(res).toMatchObject({ providerId: 'todoist', toolkitId: 'todoist', connectionId: 'todoist-existing-connection' });
    expect(s.registry.getProvider('todoist')?.displayName).toBe('Todoist');
    expect(s.registry.getToolkit('todoist')?.displayName).toBe('Todoist');
    expect(s.registry.getAction('todoist.echo')).toBeTruthy();
    expect(s.registry.getAction('mcp.todoist_official.echo')).toBeUndefined();
    expect(await s.store.list({})).toMatchObject([{
      id: 'todoist-existing-connection', providerId: 'todoist', accountId: 'todoist:default', label: 'Todoist',
    }]);
  });

  it('accepts a host-specified account identity for an official provider', async () => {
    const s = ingestSetup();
    await ingestMcpServer(s.registry, s.store, s.secretBox, {
      name: 'official', client: demoClient([]),
      identity: { providerId: 'todoist', displayName: 'Todoist', accountId: 'user-42' },
    });
    expect(await s.store.list({})).toMatchObject([{ accountId: 'user-42' }]);
  });

  it('retains connection history, account labels, and scopes when replacing a native connection', async () => {
    const s = ingestSetup();
    const original = {
      id: 'todoist-existing', ownerId: 'owner-42', providerId: 'todoist', accountId: 'old-account-id',
      label: 'My tasks', email: 'me@example.com', scopes: ['task:read', 'task:write'],
      status: 'needs_reauth' as const, createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-02T00:00:00.000Z',
      lastUsedAt: '2025-01-03T00:00:00.000Z', config: { imported: true },
    };
    await s.store.save(original, await s.secretBox.seal({ type: 'bearer', token: 'old-token' }));
    await ingestMcpServer(s.registry, s.store, s.secretBox, {
      name: 'todoist', client: demoClient([]), connectionId: original.id, sessionToken: 'new-token',
      identity: { providerId: 'todoist', displayName: 'Todoist', accountId: 'todoist:default' },
    });
    const saved = await s.store.get(original.id);
    expect(saved?.connection).toMatchObject({ ...original, accountId: 'todoist:default', status: 'active', updatedAt: expect.any(String) });
    expect(saved?.connection.updatedAt).not.toBe(original.updatedAt);
    expect(await s.secretBox.open(saved!.sealed)).toEqual({ type: 'bearer', token: 'new-token' });
  });

  it.each([{ providerId: 'another-provider', ownerId: 'local' }, { providerId: 'todoist', ownerId: 'other-owner' }])(
    'rejects a stable id belonging to a different identity: %o', async (identity) => {
      const s = ingestSetup();
      await s.store.save({
        id: 'existing', ...identity, accountId: 'account', scopes: [], status: 'active', createdAt: 'then', updatedAt: 'then',
      }, await s.secretBox.seal({ type: 'bearer', token: 'existing-token' }));
      await expect(ingestMcpServer(s.registry, s.store, s.secretBox, {
        name: 'todoist', client: demoClient([]), ownerId: 'local', connectionId: 'existing',
        identity: { providerId: 'todoist', displayName: 'Todoist' },
      })).rejects.toMatchObject({ code: 'conflict' });
      expect(s.registry.getProvider('todoist')).toBeUndefined();
      expect((await s.store.get('existing'))?.connection).toMatchObject(identity);
    },
  );

  it('exposes only the tools discovered from the server under the built-in identity', async () => {
    const s = ingestSetup();
    const result = await ingestMcpServer(s.registry, s.store, s.secretBox, {
      name: 'todoist', client: demoClient([]),
      identity: { providerId: 'todoist', displayName: 'Todoist' },
    });
    expect(result.toolCount).toBe(2);
    expect(result.tools).toHaveLength(2);
    expect(s.registry.getToolkit('todoist')?.actions.map((action) => action.id)).toEqual(
      result.tools.map((tool) => `todoist.${tool.name}`),
    );
  });

  const annotatedClient: McpClientLike = {
    async listTools() {
      return { tools: [
        { name: 'find-tasks', annotations: { readOnlyHint: true } },
        { name: 'add-tasks', annotations: { readOnlyHint: false, destructiveHint: false } },
        { name: 'delete-object', annotations: { destructiveHint: true } },
        { name: 'unknown-operation' },
      ] };
    },
    async callTool() { return { content: [{ type: 'text', text: 'ok' }] }; },
  };

  it('ignores arbitrary servers claiming to be read-only or non-destructive', async () => {
    const s = ingestSetup();
    await ingestMcpServer(s.registry, s.store, s.secretBox, { name: 'untrusted', client: annotatedClient });
    for (const name of ['find-tasks', 'add-tasks', 'delete-object', 'unknown-operation']) {
      expect(await s.runtime.runAction(`mcp.untrusted.${name}`, {})).toMatchObject({
        ok: false, reason: 'approval_required', risk: 'high',
      });
    }
  });

  it('trusts official read annotations while continuing to gate every mutation', async () => {
    const s = ingestSetup();
    await ingestMcpServer(s.registry, s.store, s.secretBox, {
      name: 'official', client: annotatedClient, trustToolAnnotations: true,
    });
    expect((await s.runtime.runAction('mcp.official.find-tasks', {})).ok).toBe(true);
    expect(await s.runtime.runAction('mcp.official.add-tasks', {})).toMatchObject({
      ok: false, reason: 'approval_required', risk: 'medium',
    });
    for (const name of ['delete-object', 'unknown-operation']) {
      expect(await s.runtime.runAction(`mcp.official.${name}`, {})).toMatchObject({
        ok: false, reason: 'approval_required', risk: 'high',
      });
    }
  });

  it('gives per-tool policies precedence over trusted annotations', async () => {
    const s = ingestSetup();
    await ingestMcpServer(s.registry, s.store, s.secretBox, {
      name: 'official', client: annotatedClient, trustToolAnnotations: true,
      toolOverrides: {
        'find-tasks': { mutating: true, risk: 'medium' },
        'add-tasks': { mutating: false },
        'delete-object': { enabled: false },
      },
    });
    expect(await s.runtime.runAction('mcp.official.find-tasks', {})).toMatchObject({
      ok: false, reason: 'approval_required', risk: 'medium',
    });
    expect((await s.runtime.runAction('mcp.official.add-tasks', {})).ok).toBe(true);
    expect(s.registry.getAction('mcp.official.delete-object')).toBeUndefined();
  });

  it('preserves structured output alongside content and redacts secrets in both', async () => {
    const s = ingestSetup();
    const content = [{ type: 'text', text: 'Task SECRET-TOKEN-92' }];
    await ingestMcpServer(s.registry, s.store, s.secretBox, {
      name: 'official',
      sessionToken: 'SECRET-TOKEN-92',
      defaultMutating: false,
      client: {
        async listTools() { return { tools: [{ name: 'find-tasks' }] }; },
        async callTool() { return { content, structuredContent: { results: [{ id: '42', content: 'SECRET-TOKEN-92' }] } }; },
      },
    });
    const out = await s.runtime.runAction('mcp.official.find-tasks', {});
    expect(out).toMatchObject({ ok: true, result: {
      server: 'official', tool: 'find-tasks', isError: false,
      structuredContent: { results: [{ id: '42' }] }, content: [{ type: 'text' }],
    } });
    expect(JSON.stringify(out)).not.toContain('SECRET-TOKEN-92');
    expect(JSON.stringify(s.runs)).not.toContain('SECRET-TOKEN-92');
  });

  it('surfaces remote tool errors as failed outcomes and audit events, with redacted diagnostics', async () => {
    const s = ingestSetup();
    await ingestMcpServer(s.registry, s.store, s.secretBox, {
      name: 'official', sessionToken: 'SECRET-TOKEN-92', defaultMutating: false,
      client: {
        async listTools() { return { tools: [{ name: 'find-tasks' }] }; },
        async callTool() { return { isError: true, content: [{ type: 'text', text: 'Unauthorized SECRET-TOKEN-92' }] }; },
      },
    });
    const out = await s.runtime.runAction('mcp.official.find-tasks', {});
    expect(out).toMatchObject({ ok: false, reason: 'error', code: 'provider_error' });
    expect(JSON.stringify(out)).toContain('Unauthorized');
    expect(JSON.stringify(out)).not.toContain('SECRET-TOKEN-92');
    expect(s.runs.filter((event) => event.phase === 'finish')).toMatchObject([{ status: 'error', errorCode: 'provider_error' }]);
    expect(JSON.stringify(s.runs)).not.toContain('SECRET-TOKEN-92');
  });

  it.each([true, false])('marks transport loss indeterminate only for mutations (mutating=%s)', async (mutating) => {
    const s = ingestSetup();
    let calls = 0;
    await ingestMcpServer(s.registry, s.store, s.secretBox, {
      name: 'official', defaultMutating: mutating,
      client: {
        async listTools() { return { tools: [{ name: 'operation' }] }; },
        async callTool() { calls++; throw new Error('Connection closed before the response arrived'); },
      },
    });
    s.setApproval(() => 'allow');
    const result = await s.runtime.runAction('mcp.official.operation', {});
    expect(result).toMatchObject({ ok: false, reason: 'error', code: 'provider_unavailable' });
    expect(result).toEqual(expect.objectContaining(mutating ? { indeterminate: true } : {}));
    if (!mutating) expect(result).not.toHaveProperty('indeterminate');
    expect(calls).toBe(1);
    expect(s.runs.find((event) => event.phase === 'finish')?.status).toBe(mutating ? 'unknown' : 'error');
  });
});

describe('jsonSchemaToZodObject (§12)', () => {
  it('maps properties + required, allows extras, falls back for an absent schema', () => {
    const obj = jsonSchemaToZodObject({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a'],
    });
    expect(obj.safeParse({ a: 'x', b: 2 }).success).toBe(true);
    expect(obj.safeParse({ b: 2 }).success).toBe(false); // missing required 'a'
    expect(obj.safeParse({ a: 'x', extra: 1 }).success).toBe(true); // passthrough extras
    expect(jsonSchemaToZodObject(undefined).safeParse({ anything: true }).success).toBe(true);
  });
});

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

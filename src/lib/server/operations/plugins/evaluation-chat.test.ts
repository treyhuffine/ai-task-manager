import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runHarnessText } from '@/lib/harness/one-shot';
import { chatWithPluginEvaluation } from './evaluation-chat';

vi.mock('@/lib/harness/one-shot', () => ({ runHarnessText: vi.fn() }));
let root: string;
const record = { format: 1, pid: process.pid, key: 'a'.repeat(64), parentOrigin: 'https://ri.example', hostOrigin: 'https://examples.example', sandboxOrigin: 'https://sandbox.example' };
const inputs = { startingMRR: 50000, monthlyGrowthRate: 5, monthlyChurnRate: 3, grossMargin: 80, fixedCosts: 40000 };
function turn() {
  return { parentOrigin: record.parentOrigin, viewUrl: `${record.hostOrigin}/s/${randomUUID().replaceAll('-', '').repeat(2)}/index.html`, turnId: randomUUID(), message: 'What growth rate do you see?', history: [], context: { invocationId: randomUUID(), revision: 2, inputs }, allowChanges: false };
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-evaluation-chat-test-'));
  vi.stubEnv('RI_MCP_APPS_EVAL_DIR', root);
  fs.writeFileSync(path.join(root, 'remote.json'), JSON.stringify(record));
  vi.mocked(runHarnessText).mockReset();
  vi.mocked(runHarnessText).mockResolvedValue({ text: 'The growth rate is 5%.', providerType: 'claude', model: 'haiku', raw: {} as never });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); fs.rmSync(root, { recursive: true, force: true }); });

it('limits authority to a fixed registered demo turn and returns only bounded chat data', async () => {
  const input = turn();
  const fetch = vi.fn(async (url: string) => Response.json(url.endsWith('/begin') ? {} : { status: 'ready', inputs }));
  vi.stubGlobal('fetch', fetch);
  const reply = await chatWithPluginEvaluation(input);
  expect(reply).toEqual({ text: 'The growth rate is 5%.', turnId: input.turnId, context: input.context, tool: { status: 'ready', inputs } });
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['http://127.0.0.1:48885/__chat/begin', 'http://127.0.0.1:48885/__chat/result']);
  expect(runHarnessText).toHaveBeenCalledWith(expect.objectContaining({
    requiredHarness: 'claude', skipPermissions: false, allowedTools: ['mcp__scenario_demo__get-scenario-data'],
    mcpServers: [{ name: 'scenario_demo', type: 'http', url: input.viewUrl.replace('/index.html', `/chat/${input.turnId}/mcp`).replace(record.hostOrigin, 'http://127.0.0.1:48885') }],
    extraArgs: expect.arrayContaining(['--restricted', '--no-session-persistence', '--setting-sources', '--tools']),
    system: expect.stringContaining('READ ONLY'),
    prompt: expect.stringContaining('"monthlyGrowthRate":5'),
  }));
  expect(JSON.stringify(reply)).not.toContain(record.key);
  expect(JSON.stringify(reply)).not.toContain('_meta');
});

it('deduplicates a turn, rejects conflicting delivery and serializes model work per view session', async () => {
  const input = turn();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(runHarnessText).mockImplementationOnce(async () => { await gate; return { text: 'Done', providerType: 'claude', model: undefined, raw: {} as never }; });
  const fetch = vi.fn(async (url: string) => Response.json(url.endsWith('/begin') ? {} : { status: 'unused' }));
  vi.stubGlobal('fetch', fetch);
  const first = chatWithPluginEvaluation(input);
  const second = chatWithPluginEvaluation(input);
  expect(second).toBe(first);
  expect(() => chatWithPluginEvaluation({ ...input, message: 'Different' })).toThrow('different input');
  expect(() => chatWithPluginEvaluation({ ...input, turnId: randomUUID() })).toThrow('current reply');
  release();
  await first;
  expect(runHarnessText).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  await chatWithPluginEvaluation(input);
  expect(runHarnessText).toHaveBeenCalledTimes(1);
  vi.resetModules();
  const secondRouterInstance = await import('./evaluation-chat');
  expect(secondRouterInstance.chatWithPluginEvaluation(input)).toBe(first);
  expect(runHarnessText).toHaveBeenCalledTimes(1);
});

it('rejects other origins, arbitrary endpoints and malformed context before launching a model', () => {
  const input = turn();
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  for (const change of [{ parentOrigin: 'https://other.example' }, { viewUrl: input.viewUrl + '?extra=1' }, { viewUrl: input.viewUrl.replace(record.hostOrigin, 'https://attacker.example') }, { context: { ...input.context, inputs: { ...inputs, monthlyGrowthRate: 21 } } }]) {
    expect(() => chatWithPluginEvaluation({ ...input, ...change })).toThrow();
  }
  expect(fetch).not.toHaveBeenCalled();
  expect(runHarnessText).not.toHaveBeenCalled();
});

it('keeps failed or expired turns from being automatically rerun', async () => {
  const input = turn();
  const fetch = vi.fn(async () => Response.json({})); vi.stubGlobal('fetch', fetch);
  vi.mocked(runHarnessText).mockRejectedValueOnce(new Error('CLI failed'));
  await expect(chatWithPluginEvaluation(input)).rejects.toThrow('No call was replayed');
  await expect(chatWithPluginEvaluation(input)).rejects.toThrow('No call was replayed');
  expect(runHarnessText).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValueOnce(new Response('Ended', { status: 410 }));
  await expect(chatWithPluginEvaluation(turn())).rejects.toMatchObject({ status: 410 });
  expect(runHarnessText).toHaveBeenCalledTimes(1);
});

it('reads bounded third-party context with no tools and rejects update grants', async () => {
  const input = { ...turn(), context: { invocationId: randomUUID(), revision: 1, kind: 'public' as const, app: 'Building explorer' as const, view: 'Table' as const, text: 'Museumstraat 1, built 1885. Selected row.' } };
  const fetch = vi.fn(async (url: string) => Response.json(url.endsWith('/begin') ? {} : { status: 'unused' }));
  vi.stubGlobal('fetch', fetch);
  expect(() => chatWithPluginEvaluation({ ...input, allowChanges: true })).toThrow('read only');
  expect(() => chatWithPluginEvaluation({ ...input, context: { ...input.context, text: 'x'.repeat(12001) } })).toThrow();
  await chatWithPluginEvaluation(input);
  expect(runHarnessText).toHaveBeenCalledWith(expect.objectContaining({
    requiredHarness: 'claude', allowedTools: [],
    mcpServers: [expect.objectContaining({ name: 'public_context' })],
    system: expect.stringContaining('READ ONLY'),
    prompt: expect.stringContaining('built 1885'),
  }));
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('enables only Excalidraw reference and rendering tools for an explicitly granted owned diagram', async () => {
  const context = { invocationId: randomUUID(), revision: 3, kind: 'public' as const, app: 'Excalidraw' as const, view: 'Diagram' as const, text: 'Capture, Review, Execute', diagram: { checkpointId: 'owned_checkpoint', version: 2 } };
  const input = { ...turn(), context, allowChanges: true, message: 'Add a green Done step' };
  const tool = { status: 'ready', diagram: { invocationId: context.invocationId, checkpointId: 'new_checkpoint' } };
  const fetch = vi.fn(async (url: string) => Response.json(url.endsWith('/begin') ? {} : tool));
  vi.stubGlobal('fetch', fetch);
  const reply = await chatWithPluginEvaluation(input);
  expect(reply.tool).toEqual(tool);
  expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ context, allowChanges: true });
  expect(runHarnessText).toHaveBeenCalledWith(expect.objectContaining({
    requiredHarness: 'claude', allowedTools: ['mcp__excalidraw_demo__read_me', 'mcp__excalidraw_demo__create_view'],
    mcpServers: [expect.objectContaining({ name: 'excalidraw_demo' })],
    system: expect.stringContaining('owned_checkpoint'),
  }));
  for (const changed of [{ ...context, diagram: undefined }, { ...context, kind: 'account' as const }, { ...context, app: 'Figma' as const }]) expect(() => chatWithPluginEvaluation({ ...input, turnId: randomUUID(), context: changed })).toThrow();
});

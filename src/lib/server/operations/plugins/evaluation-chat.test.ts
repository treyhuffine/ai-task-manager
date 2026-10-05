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

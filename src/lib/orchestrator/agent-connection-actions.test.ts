import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

vi.mock('@/lib/home/device-name', () => ({ defaultDeviceName: () => 'Test Mac' }));
vi.setConfig({ testTimeout: 60_000 });

let home: TestHome;
let folder: string;
const savedHome = process.env.HOME;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-connect-agent-' });
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-connect-agent-home-'));
  process.env.HOME = folder;
  // Cursor is set up by file. Its program only has to be there.
  vi.stubEnv('CURSOR_COMMAND', '/usr/bin/true');
  fs.mkdirSync(path.join(folder, '.cursor'));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  process.env.HOME = savedHome;
  fs.rmSync(folder, { recursive: true, force: true });
  await home.cleanup();
});

async function run(name: string, input: unknown, ctx: Parameters<typeof import('./dispatch')['runAction']>[2] = { remote: false }) {
  const { runAction } = await import('./dispatch');
  return runAction(name, input, ctx);
}

it('connects, lists and disconnects an agent on the computer running Ri', async () => {
  const connected = await run('connect_agent', { client: 'cursor' });
  expect(connected).toMatchObject({ ok: true, result: { client: 'cursor', label: 'Cursor', server: 'ri', config: '~/.cursor/mcp.json', key: { name: 'Cursor on Test Mac' } } });
  expect(JSON.parse(fs.readFileSync(path.join(folder, '.cursor/mcp.json'), 'utf8')).mcpServers.ri.headers.Authorization).toMatch(/^Bearer /);

  const listed = await run('list_agent_connections', {});
  expect(listed.ok && (listed.result as Array<{ client: string }>).find(agent => agent.client === 'cursor')).toMatchObject({ installed: true, connected: true, lastUsedAt: null });

  expect(await run('disconnect_agent', { client: 'cursor' })).toMatchObject({ ok: true, result: { removed: true, revoked: true } });
  const q = await import('@/lib/db/queries');
  expect(q.listPersonalAiClients()).toEqual([]);
});

it('refuses a caller on another device, which can’t have its files changed from here', async () => {
  const result = await run('connect_agent', { client: 'cursor' }, { remote: true, caller: { location: 'elsewhere' } });
  expect(result).toMatchObject({ ok: false, error: { code: 'unsupported' } });
  expect(result.ok ? '' : result.error.suggestion).toContain('Copy setup prompt');
  expect(fs.existsSync(path.join(folder, '.cursor/mcp.json'))).toBe(false);
});

it('accepts a session on the computer running Ri', async () => {
  expect(await run('list_agent_connections', {}, { remote: true, caller: { location: 'home' } })).toMatchObject({ ok: true });
});

it('says which agents it knows, and when one isn’t installed', async () => {
  expect(await run('connect_agent', { client: 'chatgpt' })).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
  vi.stubEnv('OPENCODE_COMMAND', '/nonexistent/opencode');
  expect(await run('connect_agent', { client: 'opencode' })).toMatchObject({ ok: false, error: { code: 'not_found', message: expect.stringContaining('isn’t installed') } });
});

it('is never offered to an outside agent’s own key', async () => {
  const { permitsHomeContentAction } = await import('@/lib/external-ai/policy');
  for (const name of ['connect_agent', 'disconnect_agent', 'list_agent_connections']) expect(permitsHomeContentAction(name)).toBe(false);
});

it('reads the names people type for an agent', async () => {
  const { agentFromName } = await import('@/cli/commands/mcp');
  expect(agentFromName('claude')).toBe('claude_code');
  expect(agentFromName('Claude-Code')).toBe('claude_code');
  expect(agentFromName('gemini')).toBe('gemini_cli');
  expect(agentFromName('code')).toBe('vscode');
  expect(agentFromName('codex')).toBe('codex');
  expect(agentFromName('goose')).toBeNull();
  expect(agentFromName('chatgpt')).toBeNull();
});

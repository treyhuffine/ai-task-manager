import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serveMcp, type McpToolRegistrar } from '@integrations/engine/mcp';
import { getHostedMcpProvider } from '@integrations/engine/providers';
import { POST as connect } from '@/lib/server/operations/integrations/connectDirect';
import { POST as disconnect } from '@/lib/server/operations/integrations/disconnect';
import { DELETE as cancelSetup } from '@/lib/server/operations/integrations/mcp-servers/[id]';
import { hostedMcpDefinition } from './hosted-mcp';
import { getIntegrationRuntime, getMcpServerStore, getProviderStatuses, invalidateIntegrationRuntime } from './runtime';
import { resolveIntegrationFilter } from './workspace-filter';
import { validateMcpUrl } from './mcp-validate';

vi.mock('@/lib/db/queries', () => ({ getWorkspace: vi.fn(), deleteChannelsForConnection: vi.fn() }));

const context = { headers: new Headers(), url: 'http://localhost/connect', nextUrl: new URL('http://localhost/connect'), signal: new AbortController().signal };
let dir: string;

function running(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-onepassword-'));
  vi.stubEnv('RI_ROOT', dir);
  vi.stubEnv('INTEGRATIONS_AUTO_APPROVE', '0');
  vi.stubEnv('PATH', `${dir}${path.delimiter}${process.env.PATH ?? ''}`);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Local MCP must not make HTTP requests'); }));
  // A synthetic server exercising the real SDK's process transport. This is
  // not a captured vendor schema and never talks to an installed 1Password app.
  fs.writeFileSync(path.join(dir, '1password-mcp'), `#!${process.execPath}
const fs = require('node:fs');
const readline = require('node:readline');
fs.appendFileSync(${JSON.stringify(path.join(dir, 'pids'))}, process.pid + '\\n');
const tools = [
  { name: 'list_environments', description: 'List synthetic Environments', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
  { name: 'rename_environment', description: 'Rename a synthetic Environment', inputSchema: { type: 'object', properties: { name: { type: 'string' } } }, annotations: { readOnlyHint: false } }
];
readline.createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result;
  if (message.method === 'initialize') result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: '1password-fixture', version: '1' } };
  else if (message.method === 'tools/list') result = { tools };
  else if (message.method === 'tools/call') {
    fs.appendFileSync(${JSON.stringify(path.join(dir, 'calls'))}, JSON.stringify(message.params) + '\\n');
    result = { content: [{ type: 'text', text: 'Synthetic Development Environment' }] };
  } else result = {};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n');
});
`, { mode: 0o700 });
  invalidateIntegrationRuntime();
});

afterEach(async () => {
  invalidateIntegrationRuntime();
  const pidFile = path.join(dir, 'pids');
  const pids = fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8').trim().split('\n').map(Number) : [];
  try {
    await vi.waitFor(() => { expect(pids.filter(running)).toEqual([]); });
  } finally {
    for (const pid of pids.filter(running)) process.kill(pid, 'SIGKILL');
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('1Password local connector', () => {
  it('connects without credentials, scopes discovered tools to an agent, and revokes the process on disconnect', async () => {
    const result = await connect({ body: { providerId: 'onepassword' } }, context);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok || !('connection' in result.data)) throw new Error('Expected a connected fixture');
    const connection = result.data.connection;
    expect(connection).toMatchObject({ providerId: 'onepassword', status: 'active' });
    const runtime = await getIntegrationRuntime();
    const status = (await getProviderStatuses()).find(provider => provider.id === 'onepassword');
    expect(status?.mcp).toMatchObject({ local: true, authKind: 'none', requiresAuth: false, status: 'ok' });
    expect(runtime.getToolkits().find(toolkit => toolkit.id === 'onepassword')?.actions.find(action => action.id === 'onepassword.rename_environment')).toMatchObject({ mutating: true, risk: 'high' });

    const tools = new Map<string, Parameters<McpToolRegistrar['registerTool']>[2]>();
    const registrar: McpToolRegistrar = { registerTool: (name, _config, handler) => { tools.set(name, handler); } };
    const excluded = await resolveIntegrationFilter([], runtime, 'local');
    serveMcp(registrar, runtime, { ownerId: 'local', ...excluded });
    expect(tools.size).toBe(0);
    const allowed = await resolveIntegrationFilter([{ toolkitId: 'onepassword' }], runtime, 'local');
    serveMcp(registrar, runtime, { ownerId: 'local', ...allowed });
    expect([...tools.keys()]).toEqual(['onepassword__list_environments', 'onepassword__rename_environment']);
    const response = await tools.get('onepassword__list_environments')!({});
    expect(response.isError).toBeUndefined();
    expect(JSON.stringify(response)).toContain('Synthetic Development Environment');
    expect(fs.readFileSync(path.join(dir, 'calls'), 'utf8')).toContain('list_environments');
    const mutation = await tools.get('onepassword__rename_environment')!({ name: 'Changed' });
    expect(JSON.parse(mutation.content[0]!.text)).toMatchObject({ status: 'approval_required' });
    expect(fs.readFileSync(path.join(dir, 'calls'), 'utf8')).not.toContain('rename_environment');

    const pid = Number(fs.readFileSync(path.join(dir, 'pids'), 'utf8').trim());
    expect(running(pid)).toBe(true);
    expect(await disconnect({ body: { id: connection.id } }, context)).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(running(pid)).toBe(false));
    expect((await getIntegrationRuntime()).getToolkits().some(toolkit => toolkit.id === 'onepassword')).toBe(false);
    expect(getMcpServerStore().list()).toEqual([]);
  });

  it('reports installation steps when the executable is missing and keeps setup removable', async () => {
    fs.unlinkSync(path.join(dir, '1password-mcp'));
    vi.stubEnv('PATH', dir);
    const result = await connect({ body: { providerId: 'onepassword' } }, context);
    expect(result).toMatchObject({ ok: false, status: 400, body: { error: expect.stringContaining('Install 1Password Desktop on the computer running Ri') } });
    expect(getMcpServerStore().list()).toHaveLength(1);
    expect((await getIntegrationRuntime()).getToolkits().some(toolkit => toolkit.id === 'onepassword')).toBe(false);
    expect(await cancelSetup({ params: { id: getMcpServerStore().list()[0]!.id }, body: {} }, context)).toMatchObject({ ok: true });
    expect(getMcpServerStore().list()).toEqual([]);
  });

  it('pins the desktop command and rejects credentials or replacement endpoints', async () => {
    expect(getHostedMcpProvider('onepassword')).toMatchObject({ localCommand: '1password-mcp', auth: { kind: 'none' } });
    expect(validateMcpUrl('stdio:arbitrary-command').ok).toBe(false);
    expect(await connect({ body: { providerId: 'onepassword', fields: { command: 'arbitrary-command' } } }, context)).toMatchObject({ ok: false, status: 400 });
    expect(await connect({ body: { providerId: 'onepassword', instanceUrl: 'https://replacement.example/mcp' } }, context)).toMatchObject({ ok: false, status: 400 });
    const result = await connect({ body: { providerId: 'onepassword' } }, context);
    expect(result.ok).toBe(true);
    const entry = getMcpServerStore().list()[0]!;
    expect(() => hostedMcpDefinition({ ...entry, url: 'stdio:arbitrary-command' })).toThrow('trusted service configuration');
    expect(() => hostedMcpDefinition({ ...entry, url: 'https://replacement.example/mcp' })).toThrow('trusted service configuration');
  });
});

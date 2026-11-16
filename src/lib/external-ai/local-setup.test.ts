/**
 * One-click setup on a disposable Ri, with every agent's configuration in a
 * temporary home folder. Claude Code, Codex and Antigravity run their real
 * CLIs where they're installed (skipped where they aren't), so the entry Ri
 * writes is the one those agents read back.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { PUBLIC_BASE_URL_ENV } from '@/lib/server-runtime/record';

const mocks = vi.hoisted(() => ({
  /** Programs found on PATH, by name, for agents that aren't harnesses. */
  path: {} as Record<string, string | null>,
}));

/**
 * Harnesses are pointed at their program by its command override, as
 * src/test/setup-env.ts asks. Claude Code, Codex and Antigravity are their
 * real CLIs where installed: only their `mcp` commands run, on temporary
 * configuration, never a model.
 */
function harnesses(commands: Partial<Record<'CLAUDE' | 'CODEX' | 'ANTIGRAVITY' | 'CURSOR' | 'OPENCODE', string | null>>) {
  for (const name of ['CLAUDE', 'CODEX', 'ANTIGRAVITY', 'CURSOR', 'OPENCODE'] as const) vi.stubEnv(`${name}_COMMAND`, commands[name] ?? '/nonexistent/no-harness');
}

vi.mock('@agentex/agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agentex/agent')>()),
  findBinary: async (name: string, override?: string) => {
    const bin = override ? (fs.existsSync(override) ? override : null) : mocks.path[name];
    if (!bin) throw new Error(`${name} not found`);
    return { bin, prefixArgs: [] };
  },
}));
vi.mock('@/lib/home/device-name', () => ({ defaultDeviceName: () => 'Test Mac' }));
vi.setConfig({ testTimeout: 60_000 });

function which(name: string): string | null {
  try { return execFileSync('which', [name], { encoding: 'utf8' }).trim() || null; } catch { return null; }
}
const CLAUDE = which('claude');
const CODEX = which('codex');
const AGY = which('agy');

let home: TestHome;
let folder: string;
const saved = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, CODEX_HOME: process.env.CODEX_HOME };

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-local-setup-' });
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-agent-home-'));
  process.env.HOME = folder;
  process.env.CLAUDE_CONFIG_DIR = path.join(folder, '.claude-config');
  process.env.CODEX_HOME = path.join(folder, '.codex');
  fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });
  harnesses({ CLAUDE, CODEX, ANTIGRAVITY: AGY, CURSOR: '/usr/bin/true' });
  mocks.path = { gemini: '/usr/bin/true', npx: null, code: null };
});
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(folder, { recursive: true, force: true });
  await home.cleanup();
});

async function setup() {
  return import('./local-setup');
}
async function queries() {
  return import('@/lib/db/queries');
}
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
const mode = (file: string) => fs.statSync(path.join(folder, file)).mode & 0o777;
const activeKeys = async () => (await queries()).listPersonalAiClients();

describe.skipIf(!CLAUDE)('Claude Code, through its own CLI', () => {
  it('connects at user scope with the key in the header, then disconnects and revokes it', async () => {
    const { connectLocalAgent, disconnectLocalAgent, listLocalAgents, localMcpUrl } = await setup();
    const result = await connectLocalAgent('claude_code');
    expect(result).toMatchObject({ kind: 'claude_code', server: 'ri', config: '~/.claude-config/.claude.json', connection: { name: 'Claude Code on Test Mac', client: 'claude_code' } });
    const entry = read('.claude-config/.claude.json').mcpServers.ri;
    expect(entry).toMatchObject({ type: 'http', url: localMcpUrl() });
    const token = (entry.headers.Authorization as string).replace('Bearer ', '');
    expect((await queries()).findPersonalAiClientByToken(token)?.keyId).toBe(result.connection.keyId);
    expect(mode('.claude-config/.claude.json')).toBe(0o600);
    // Ri's skills went in Claude Code's own folder, as links.
    expect(fs.lstatSync(path.join(folder, '.claude/skills/agent-work-tasks-notes_ri')).isSymbolicLink()).toBe(true);
    expect(result.skills).toEqual({ state: 'ready', blocked: [] });

    const listed = (await listLocalAgents()).find(agent => agent.kind === 'claude_code')!;
    expect(listed).toMatchObject({ installed: true, stale: null, connection: { keyId: result.connection.keyId } });

    expect(await disconnectLocalAgent('claude_code')).toEqual({ removed: true, revoked: true });
    expect(read('.claude-config/.claude.json').mcpServers?.ri).toBeUndefined();
    expect(await activeKeys()).toEqual([]);
  });

  it('replaces its own earlier connection and revokes the earlier key', async () => {
    const { connectLocalAgent } = await setup();
    const first = await connectLocalAgent('claude_code');
    const second = await connectLocalAgent('claude_code');
    expect(second.connection.keyId).not.toBe(first.connection.keyId);
    expect((await activeKeys()).map(key => key.keyId)).toEqual([second.connection.keyId]);
  });
});

/**
 * A `claude` whose `mcp add` fails: `remove` and `add-json` work on its file
 * the way Claude Code's do, so a failed add after the remove is visible.
 */
const FAILING_CLAUDE = `#!/usr/bin/env node
const fs = require('fs');
const file = require('path').join(process.env.CLAUDE_CONFIG_DIR, '.claude.json');
const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
const rest = process.argv.slice(4).filter((arg, i, all) => arg !== '--scope' && all[i - 1] !== '--scope');
const config = read();
if (process.argv[3] === 'remove') { delete (config.mcpServers ?? {})[rest[0]]; fs.writeFileSync(file, JSON.stringify(config)); process.exit(0); }
if (process.argv[3] === 'add-json') { config.mcpServers = { ...config.mcpServers, [rest[0]]: JSON.parse(rest[1]) }; fs.writeFileSync(file, JSON.stringify(config)); process.exit(0); }
console.error('add failed');
process.exit(1);
`;

describe('Claude Code, when adding Ri’s entry fails', () => {
  async function brokenClaude() {
    const fake = path.join(folder, 'claude');
    fs.writeFileSync(fake, FAILING_CLAUDE, { mode: 0o755 });
    harnesses({ CLAUDE: fake });
    const { client, token } = (await queries()).createPersonalAiClient('Claude Code on Test Mac', 'claude_code');
    // What Set up wrote before: the HTTPS address no outside agent trusts.
    const original = { type: 'http', url: 'https://localhost:42242/api/orchestrator/mcp', headers: { Authorization: `Bearer ${token.plaintext}` } };
    fs.mkdirSync(path.join(folder, '.claude-config'), { recursive: true });
    fs.writeFileSync(path.join(folder, '.claude-config/.claude.json'), JSON.stringify({ mcpServers: { ri: original } }));
    return { original, keyId: client.keyId };
  }

  it('puts the entry back as it was, so the next start tries the move again', async () => {
    const { original } = await brokenClaude();
    const { localAgentState, repairLocalAgents } = await setup();
    expect(await repairLocalAgents()).toEqual([]);
    expect(read('.claude-config/.claude.json').mcpServers.ri).toEqual(original);
    expect(await localAgentState('claude_code')).toMatchObject({ connection: null, stale: 'moved' });
  });

  it('leaves the earlier entry and its key working when Set up fails', async () => {
    const { original, keyId } = await brokenClaude();
    const { connectLocalAgent } = await setup();
    await expect(connectLocalAgent('claude_code')).rejects.toMatchObject({ code: 'failed', message: 'add failed' });
    expect(read('.claude-config/.claude.json').mcpServers.ri).toEqual(original);
    // The new key is revoked again and the earlier one still works.
    expect((await activeKeys()).map(key => key.keyId)).toEqual([keyId]);
  });
});

describe.skipIf(!CODEX)('Codex, through its own CLI', () => {
  it('adds the key as a static header Codex reads, and leaves the rest of the file byte for byte', async () => {
    // Formatting `codex mcp add` would rewrite: an empty array, an integer timeout, unsorted env.
    const mine = '# My settings\nmodel = "gpt-5"\n\n\n[mcp_servers.other]\ncommand = "node"\nargs = []\nstartup_timeout_sec = 120\n\n[mcp_servers.other.env]\nZED = "1"\nALPHA = "2"\n';
    fs.writeFileSync(path.join(folder, '.codex/config.toml'), mine);
    const { connectLocalAgent, disconnectLocalAgent, localMcpUrl } = await setup();
    const result = await connectLocalAgent('codex');
    const env = { ...process.env, CODEX_HOME: path.join(folder, '.codex') };
    const got = JSON.parse(execFileSync(CODEX!, ['mcp', 'get', 'ri', '--json'], { env, encoding: 'utf8' }));
    expect(got.transport.url).toBe(localMcpUrl());
    const token = (got.transport.http_headers.Authorization as string).replace('Bearer ', '');
    expect((await queries()).findPersonalAiClientByToken(token)?.keyId).toBe(result.connection.keyId);
    expect(mode('.codex/config.toml')).toBe(0o600);
    expect(fs.lstatSync(path.join(folder, '.agents/skills/agent-work-tasks-notes_ri')).isSymbolicLink()).toBe(true);

    // A second Set up leaves one valid table, not two.
    await connectLocalAgent('codex');
    expect(JSON.parse(execFileSync(CODEX!, ['mcp', 'get', 'ri', '--json'], { env, encoding: 'utf8' })).transport.http_headers.Authorization).toMatch(/^Bearer /);

    expect(fs.readFileSync(path.join(folder, '.codex/config.toml'), 'utf8').startsWith(mine)).toBe(true);

    await disconnectLocalAgent('codex');
    expect(fs.readFileSync(path.join(folder, '.codex/config.toml'), 'utf8')).toBe(mine);
    expect(await activeKeys()).toEqual([]);
  });
});

describe.skipIf(!AGY)('Antigravity, through its own CLI', () => {
  it('writes serverUrl and the header, readable only by its owner', async () => {
    const { connectLocalAgent, disconnectLocalAgent, localMcpUrl } = await setup();
    await connectLocalAgent('antigravity');
    const entry = read('.gemini/config/mcp_config.json').mcpServers.ri;
    expect(entry.serverUrl).toBe(localMcpUrl());
    expect(entry.headers.Authorization).toMatch(/^Bearer /);
    expect(mode('.gemini/config/mcp_config.json')).toBe(0o600);
    // Antigravity can't read a linked skill outside a chat's folder, so it gets copies.
    const skill = path.join(folder, '.gemini/config/skills/agent-work-tasks-notes_ri');
    expect(fs.lstatSync(skill).isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(skill, 'SKILL.md'))).toBe(true);
    await disconnectLocalAgent('antigravity');
    expect(read('.gemini/config/mcp_config.json').mcpServers?.ri).toBeUndefined();
  });
});

describe('Codex’s tables', () => {
  it('removes Ri’s table and the ones under it, and nothing else', async () => {
    const { withoutCodexTables } = await setup();
    const text = 'a = 1\n\n[mcp_servers.ri]\nurl = "x"\n\n[mcp_servers.ri-dev]\nurl = "y"\n\n[mcp_servers.ri.http_headers]\nAuthorization = "Bearer k"\n\n[mcp_servers."ri".env]\nA = "1"\n[profiles.ri]\nmodel = "m"\n';
    expect(withoutCodexTables(text, 'ri')).toBe('a = 1\n\n[mcp_servers.ri-dev]\nurl = "y"\n\n[profiles.ri]\nmodel = "m"\n');
    expect(withoutCodexTables(text, 'ri-dev')).toBe(text.replace('[mcp_servers.ri-dev]\nurl = "y"\n\n', ''));
    expect(withoutCodexTables('', 'ri')).toBe('');
  });
});

describe('agents configured by file', () => {
  it('edits Cursor’s file in place: comments, other servers and a linked file all stay', async () => {
    const dotfiles = path.join(folder, 'dotfiles');
    fs.mkdirSync(dotfiles);
    fs.mkdirSync(path.join(folder, '.cursor'));
    fs.writeFileSync(path.join(dotfiles, 'mcp.json'), '{\n  // Mine\n  "mcpServers": {\n    "other": { "url": "https://other.example/mcp" },\n  },\n}\n', { mode: 0o644 });
    fs.symlinkSync(path.join(dotfiles, 'mcp.json'), path.join(folder, '.cursor/mcp.json'));
    const { connectLocalAgent, disconnectLocalAgent, localMcpUrl } = await setup();

    const result = await connectLocalAgent('cursor');
    expect(fs.lstatSync(path.join(folder, '.cursor/mcp.json')).isSymbolicLink()).toBe(true);
    const text = fs.readFileSync(path.join(dotfiles, 'mcp.json'), 'utf8');
    expect(text).toContain('// Mine');
    expect(text).toContain('"other"');
    expect(fs.statSync(path.join(dotfiles, 'mcp.json')).mode & 0o777).toBe(0o600);
    const { parse } = await import('jsonc-parser');
    expect(parse(text).mcpServers.ri).toEqual({ url: localMcpUrl(), headers: { Authorization: expect.stringMatching(/^Bearer ri_/) } });
    expect(result.next).toContain('Cursor Settings');

    await disconnectLocalAgent('cursor');
    const after = fs.readFileSync(path.join(dotfiles, 'mcp.json'), 'utf8');
    expect(parse(after).mcpServers).toEqual({ other: { url: 'https://other.example/mcp' } });
    expect(after).toContain('// Mine');
  });

  it('writes VS Code’s user configuration, under servers', async () => {
    const user = process.platform === 'darwin' ? 'Library/Application Support/Code/User' : '.config/Code/User';
    fs.mkdirSync(path.join(folder, user), { recursive: true });
    mocks.path.code = null;
    const { connectLocalAgent, localMcpUrl } = await setup();
    await connectLocalAgent('vscode');
    expect(read(`${user}/mcp.json`)).toEqual({ servers: { ri: { type: 'http', url: localMcpUrl(), headers: { Authorization: expect.stringMatching(/^Bearer /) } } } });
  });

  it('keeps Gemini CLI’s other settings', async () => {
    fs.mkdirSync(path.join(folder, '.gemini'));
    fs.writeFileSync(path.join(folder, '.gemini/settings.json'), JSON.stringify({ theme: 'Dracula', security: { auth: { selectedType: 'oauth-personal' } } }));
    const { connectLocalAgent, localMcpUrl } = await setup();
    await connectLocalAgent('gemini_cli');
    expect(read('.gemini/settings.json')).toEqual({
      theme: 'Dracula', security: { auth: { selectedType: 'oauth-personal' } },
      mcpServers: { ri: { type: 'http', url: localMcpUrl(), headers: { Authorization: expect.stringMatching(/^Bearer /) } } },
    });
  });
});

describe('what Set up refuses', () => {
  it('leaves a server of the same name that isn’t a Ri’s, and leaves no key behind', async () => {
    fs.mkdirSync(path.join(folder, '.cursor'));
    const mine = JSON.stringify({ mcpServers: { ri: { url: 'https://ri-something-else.example/mcp' } } });
    fs.writeFileSync(path.join(folder, '.cursor/mcp.json'), mine);
    const { connectLocalAgent, LocalSetupError } = await setup();
    await expect(connectLocalAgent('cursor')).rejects.toBeInstanceOf(LocalSetupError);
    await expect(connectLocalAgent('cursor')).rejects.toThrow(/isn’t Ri’s/);
    expect(fs.readFileSync(path.join(folder, '.cursor/mcp.json'), 'utf8')).toBe(mine);
    expect(await activeKeys()).toEqual([]);
  });

  it('leaves a file it can’t parse, and leaves no key behind', async () => {
    fs.mkdirSync(path.join(folder, '.cursor'));
    fs.writeFileSync(path.join(folder, '.cursor/mcp.json'), '{ "mcpServers": ');
    const { connectLocalAgent } = await setup();
    await expect(connectLocalAgent('cursor')).rejects.toThrow(/isn’t valid JSON/);
    expect(fs.readFileSync(path.join(folder, '.cursor/mcp.json'), 'utf8')).toBe('{ "mcpServers": ');
    expect(await activeKeys()).toEqual([]);
  });

  it('says an agent isn’t installed, and makes no key', async () => {
    mocks.path.gemini = null;
    const { connectLocalAgent } = await setup();
    await expect(connectLocalAgent('gemini_cli')).rejects.toMatchObject({ code: 'not_installed' });
    expect(await activeKeys()).toEqual([]);
  });

  it('revokes the new key when the configuration can’t be written', async () => {
    fs.mkdirSync(path.join(folder, '.cursor'), { mode: 0o500 });
    const { connectLocalAgent } = await setup();
    try {
      await expect(connectLocalAgent('cursor')).rejects.toThrow(/Could not add Ri to Cursor/);
      expect(await activeKeys()).toEqual([]);
    } finally {
      fs.chmodSync(path.join(folder, '.cursor'), 0o700);
    }
  });

  it('finds a harness by its command override, like the harness registry runs it', async () => {
    const { localAgentState } = await setup();
    harnesses({ CURSOR: '/usr/bin/true' });
    expect(await localAgentState('opencode')).toMatchObject({ installed: false });
    harnesses({ OPENCODE: '/usr/bin/true' });
    expect(await localAgentState('opencode')).toMatchObject({ installed: true, config: '~/.config/opencode/opencode.json' });
  });

  it('can’t set up an agent without a way to do it here', async () => {
    const { connectLocalAgent } = await setup();
    await expect(connectLocalAgent('goose')).rejects.toMatchObject({ code: 'unsupported' });
    await expect(connectLocalAgent('chatgpt')).rejects.toMatchObject({ code: 'unsupported' });
  });
});

describe('the address agents here use', () => {
  const cursorUrl = async (): Promise<string> => (await import('jsonc-parser')).parse(fs.readFileSync(path.join(folder, '.cursor/mcp.json'), 'utf8')).mcpServers.ri.url;
  const setCursorUrl = (url: string) => {
    const file = path.join(folder, '.cursor/mcp.json');
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    value.mcpServers.ri.url = url;
    fs.writeFileSync(file, JSON.stringify(value));
  };

  it('is Ri’s plain loopback address when Ri serves HTTPS here, never the certificate only the desktop app trusts', async () => {
    // The always-on service: the desktop app opens the HTTPS gateway, and the server behind it has its own port.
    vi.stubEnv(PUBLIC_BASE_URL_ENV, 'https://localhost:42242');
    vi.stubEnv('PORT', '42243');
    fs.mkdirSync(path.join(folder, '.cursor'));
    const { connectLocalAgent, localMcpUrl } = await setup();
    expect(localMcpUrl()).toBe('http://127.0.0.1:42243/api/orchestrator/mcp');
    await connectLocalAgent('cursor');
    expect(await cursorUrl()).toBe('http://127.0.0.1:42243/api/orchestrator/mcp');
  });

  it('moves its own entry from an old address on this computer, keeping its key', async () => {
    fs.mkdirSync(path.join(folder, '.cursor'));
    const { connectLocalAgent, localAgentState, localMcpUrl, repairLocalAgents } = await setup();
    const first = await connectLocalAgent('cursor');
    // What Set up wrote before: the HTTPS address no outside agent trusts.
    setCursorUrl('https://localhost:42242/api/orchestrator/mcp');
    expect(await localAgentState('cursor')).toMatchObject({ connection: null, stale: 'moved' });

    expect(await repairLocalAgents()).toEqual(['cursor']);
    expect(await cursorUrl()).toBe(localMcpUrl());
    expect(await localAgentState('cursor')).toMatchObject({ connection: { keyId: first.connection.keyId }, stale: null });
    expect((await activeKeys()).map(key => key.keyId)).toEqual([first.connection.keyId]);
    // Nothing left to move.
    expect(await repairLocalAgents()).toEqual([]);
  });

  it('leaves a remote address someone chose, and an entry whose key was revoked', async () => {
    fs.mkdirSync(path.join(folder, '.cursor'));
    fs.mkdirSync(path.join(folder, '.gemini'));
    const { connectLocalAgent, localAgentState, repairLocalAgents } = await setup();
    await connectLocalAgent('cursor');
    setCursorUrl('https://ri-trey.beamd.run/api/orchestrator/mcp');
    const gemini = await connectLocalAgent('gemini_cli');
    (await queries()).revokePersonalAiClient(gemini.connection.keyId);
    const settings = read('.gemini/settings.json');
    settings.mcpServers.ri.url = 'https://localhost:42242/api/orchestrator/mcp';
    fs.writeFileSync(path.join(folder, '.gemini/settings.json'), JSON.stringify(settings));

    expect(await repairLocalAgents()).toEqual([]);
    expect(await cursorUrl()).toBe('https://ri-trey.beamd.run/api/orchestrator/mcp');
    expect(read('.gemini/settings.json').mcpServers.ri.url).toBe('https://localhost:42242/api/orchestrator/mcp');
    expect(await localAgentState('gemini_cli')).toMatchObject({ connection: null, stale: 'revoked' });
  });

  it('says what to do in the agent to load Ri', async () => {
    const { localAgentState } = await setup();
    expect((await localAgentState('antigravity')).next).toBe('Start a new Antigravity conversation.');
  });
});

describe('reading back what’s connected', () => {
  it('shows an entry whose key was revoked as stale, and a new Set up replaces it', async () => {
    fs.mkdirSync(path.join(folder, '.cursor'));
    const { connectLocalAgent, localAgentState } = await setup();
    const first = await connectLocalAgent('cursor');
    (await queries()).revokePersonalAiClient(first.connection.keyId);
    expect(await localAgentState('cursor')).toMatchObject({ installed: true, connection: null, stale: 'revoked' });
    const second = await connectLocalAgent('cursor');
    expect(await localAgentState('cursor')).toMatchObject({ connection: { keyId: second.connection.keyId }, stale: null });
  });

  it('reports agents that aren’t installed, and refuses on a team', async () => {
    mocks.path = {};
    harnesses({});
    const { listLocalAgents } = await setup();
    const agents = await listLocalAgents();
    expect(agents.map(agent => agent.kind)).toEqual(['claude_code', 'codex', 'cursor', 'vscode', 'claude_desktop', 'gemini_cli', 'opencode', 'antigravity', 'kiro']);
    // VS Code and Claude are found by their apps in /Applications, which this test can't control.
    for (const agent of agents.filter(a => !['vscode', 'claude_desktop'].includes(a.kind))) expect(agent, agent.kind).toMatchObject({ installed: false, connection: null });
  });
});

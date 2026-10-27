import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AI_CLIENTS,
  KEY_PLACEHOLDER,
  aiClient,
  aiClientInstallLink,
  aiClientOfKey,
  aiClientSetup,
  aiClientSetupPrompt,
  personalMcpNames,
  teamConnectionTarget,
  type AiConnectionTarget,
} from './client-config';

const personal: AiConnectionTarget = { space: { kind: 'personal' }, mcpUrl: 'https://ri.example/api/orchestrator/mcp', ...personalMcpNames('production') };
const team = teamConnectionTarget('Acme Labs', 'https://acme.example/api/team/mcp');
const TOKEN = 'ri_live_abc123';

function onPath(name: string): boolean {
  try { execFileSync('which', [name], { stdio: 'ignore' }); return true; } catch { return false; }
}

describe('the list', () => {
  it('starts with the most popular agents and ends with another Ri and any MCP client', () => {
    expect(AI_CLIENTS.map(client => client.kind)).toEqual([
      'claude_code', 'codex', 'cursor', 'vscode',
      'claude_desktop', 'gemini_cli', 'windsurf', 'opencode', 'antigravity', 'goose', 'kiro', 'lm_studio',
      'chatgpt', 'ri', 'other',
    ]);
  });

  it('follows the copy rules: no em dashes or semicolons anywhere a person reads', () => {
    for (const target of [personal, team]) {
      for (const client of AI_CLIENTS) {
        const setup = aiClientSetup(client.kind, target, TOKEN);
        const words = [client.label, client.blurb, client.limitation ?? '', setup.caveat ?? '', ...setup.steps.map(step => step.label)];
        for (const text of words) {
          expect(text, `${client.kind}: ${text}`).not.toMatch(/—|–/);
          expect(text, `${client.kind}: ${text}`).not.toContain(';');
        }
      }
    }
  });

  it('gives every agent complete steps, except one that states why it can’t connect yet', () => {
    for (const client of AI_CLIENTS) {
      const setup = aiClientSetup(client.kind, personal, TOKEN);
      if (client.limitation) {
        expect(setup.steps).toEqual([]);
        expect(setup.caveat).toBe(client.limitation);
      } else {
        expect(setup.steps.length, client.kind).toBeGreaterThan(0);
        expect(setup.steps.some(step => step.secret && step.text.includes(TOKEN)), client.kind).toBe(true);
      }
    }
    expect(aiClient('chatgpt').limitation).toMatch(/OAuth/);
  });

  it('waits for a key: placeholders and secret marks exactly where the key goes', () => {
    for (const client of AI_CLIENTS.filter(c => !c.limitation)) {
      const pending = aiClientSetup(client.kind, personal);
      const made = aiClientSetup(client.kind, personal, TOKEN);
      pending.steps.forEach((step, index) => {
        expect(step.text.includes(KEY_PLACEHOLDER), `${client.kind} step ${index}`).toBe(Boolean(step.secret));
        expect(made.steps[index].text.includes(TOKEN), `${client.kind} step ${index}`).toBe(Boolean(step.secret));
        expect(made.steps[index].text).not.toContain(KEY_PLACEHOLDER);
      });
    }
  });

  it('maps old keys by their default names, and anything else to any MCP client', () => {
    expect(aiClientOfKey({ client: 'cursor', name: 'Whatever' })).toBe('cursor');
    expect(aiClientOfKey({ client: null, name: 'Claude Code' })).toBe('claude_code');
    expect(aiClientOfKey({ client: null, name: 'Codex' })).toBe('codex');
    expect(aiClientOfKey({ client: null, name: 'My Ri' })).toBe('ri');
    expect(aiClientOfKey({ client: null, name: 'Laptop assistant' })).toBe('other');
    expect(aiClientOfKey({ client: 'something-new', name: 'x' })).toBe('other');
  });
});

describe('names', () => {
  it('calls a personal Ri ri, a development one ri-dev, and a team after itself', () => {
    expect(personalMcpNames('production')).toEqual({ server: 'ri', tokenVar: 'RI_MCP_TOKEN' });
    expect(personalMcpNames('development')).toEqual({ server: 'ri-dev', tokenVar: 'RI_DEV_MCP_TOKEN' });
    expect(team).toMatchObject({ server: 'ri-acme-labs', tokenVar: 'RI_ACME_LABS_TOKEN' });
    expect(teamConnectionTarget('Café & Co.', 'x')).toMatchObject({ server: 'ri-cafe-co', tokenVar: 'RI_CAFE_CO_TOKEN' });
    expect(teamConnectionTarget('  --  ', 'x')).toMatchObject({ server: 'ri-team', tokenVar: 'RI_TEAM_TOKEN' });
    expect(teamConnectionTarget('x'.repeat(80), 'x').tokenVar).toMatch(/^RI_X{32}_TOKEN$/);
    // Never a credential name Claude Code blanks out, never starting with a digit.
    for (const name of ['Anthropic Api', '42 Crew']) expect(teamConnectionTarget(name, 'x').tokenVar).toMatch(/^RI_[A-Z0-9_]+_TOKEN$/);
  });
});

describe('steps by hand', () => {
  it('keeps the key in the shell profile and out of Claude Code’s stored command', () => {
    const setup = aiClientSetup('claude_code', team, TOKEN);
    expect(setup.steps.map(step => step.text)).toEqual([
      "export RI_ACME_LABS_TOKEN='ri_live_abc123'",
      "claude mcp add --transport http --scope user ri-acme-labs 'https://acme.example/api/team/mcp' --header 'Authorization: Bearer ${RI_ACME_LABS_TOKEN}'",
    ]);
    expect(setup.steps[1].text).not.toContain(TOKEN);
    expect(setup.steps[1].label).toContain('Acme Labs');
  });

  it('quotes a key safely for the shell', () => {
    expect(aiClientSetup('claude_code', team, "a'b").steps[0].text).toBe("export RI_ACME_LABS_TOKEN='a'\\''b'");
  });

  it('gives Codex a table the CLI and the app both read, with the key as a static header', () => {
    const [step] = aiClientSetup('codex', personal, TOKEN).steps;
    expect(step.text).toBe('[mcp_servers.ri]\nurl = "https://ri.example/api/orchestrator/mcp"\nhttp_headers = { Authorization = "Bearer ri_live_abc123" }');
    expect(step.label).toContain('~/.codex/config.toml');
  });

  it.skipIf(!onPath('codex'))('writes a Codex table Codex itself reads', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-codex-steps-'));
    try {
      fs.writeFileSync(path.join(codexHome, 'config.toml'), `${aiClientSetup('codex', team, TOKEN).steps[0].text}\n`);
      const parsed = JSON.parse(execFileSync('codex', ['mcp', 'get', 'ri-acme-labs', '--json'], { env: { ...process.env, CODEX_HOME: codexHome }, encoding: 'utf8' }));
      expect(parsed.transport).toMatchObject({ type: 'streamable_http', url: team.mcpUrl, http_headers: { Authorization: `Bearer ${TOKEN}` } });
    } finally {
      fs.rmSync(codexHome, { recursive: true, force: true });
    }
  });

  it('gives each JSON agent its own documented shape', () => {
    const entry = (kind: Parameters<typeof aiClientSetup>[0]) => JSON.parse(aiClientSetup(kind, personal, TOKEN).steps[0].text);
    const headers = { Authorization: `Bearer ${TOKEN}` };
    const url = personal.mcpUrl;
    expect(entry('cursor')).toEqual({ mcpServers: { ri: { url, headers } } });
    expect(entry('vscode')).toEqual({ servers: { ri: { type: 'http', url, headers } } });
    expect(entry('gemini_cli')).toEqual({ mcpServers: { ri: { type: 'http', url, headers } } });
    expect(entry('windsurf')).toEqual({ mcpServers: { ri: { serverUrl: url, headers } } });
    expect(entry('opencode')).toEqual({ $schema: 'https://opencode.ai/config.json', mcp: { ri: { type: 'remote', url, enabled: true, oauth: false, headers } } });
    expect(entry('antigravity')).toEqual({ mcpServers: { ri: { serverUrl: url, headers } } });
    expect(entry('kiro')).toEqual({ mcpServers: { ri: { url, headers } } });
    expect(entry('lm_studio')).toEqual({ mcpServers: { ri: { url, headers } } });
    expect(entry('claude_desktop')).toEqual({ mcpServers: { ri: {
      command: 'npx',
      args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${RI_AUTH_HEADER}', '--transport', 'http-only'],
      env: { RI_AUTH_HEADER: `Bearer ${TOKEN}` },
    } } });
  });

  it('gives Goose its YAML extension, and any client the address and the header', () => {
    const goose = aiClientSetup('goose', personal, TOKEN).steps[0].text;
    expect(goose).toContain('type: streamable_http');
    expect(goose).toContain(`uri: ${personal.mcpUrl}`);
    expect(goose).toContain(`Authorization: Bearer ${TOKEN}`);
    const other = aiClientSetup('other', personal, TOKEN).steps;
    expect(other.map(step => step.text).slice(0, 2)).toEqual([personal.mcpUrl, `Authorization: Bearer ${TOKEN}`]);
    expect(JSON.parse(other[2].text)).toEqual({ mcpServers: { ri: { type: 'http', url: personal.mcpUrl, headers: { Authorization: `Bearer ${TOKEN}` } } } });
  });

  it('maps another Ri to its Add MCP server fields', () => {
    const setup = aiClientSetup('ri', team, TOKEN);
    expect(setup.steps.map(step => step.text)).toEqual(['Acme Labs', team.mcpUrl, TOKEN]);
    expect(setup.steps[0].label).toContain('Settings → Plugins → Add MCP server');
    expect(setup.steps[2].label).toContain('Bearer token');
    expect(setup.caveat).toContain('Add and connect');
    expect(aiClientSetup('ri', personal, TOKEN).steps[0].text).toBe('My Ri');
  });
});

describe('install links', () => {
  const params = (href: string) => new URL(href).searchParams;
  const decode = (value: string) => JSON.parse(Buffer.from(value, 'base64').toString('utf8'));

  it('opens Cursor with its base64 server entry, through its own scheme and never cursor.com', () => {
    const link = aiClientInstallLink('cursor', personal, TOKEN)!;
    expect(link.label).toBe('Add to Cursor');
    expect(link.href.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?')).toBe(true);
    expect(params(link.href).get('name')).toBe('ri');
    expect(decode(params(link.href).get('config')!)).toEqual({ url: personal.mcpUrl, headers: { Authorization: `Bearer ${TOKEN}` } });
  });

  it('opens VS Code with the URL-encoded server and its name', () => {
    const link = aiClientInstallLink('vscode', team, TOKEN)!;
    expect(link.href.startsWith('vscode:mcp/install?')).toBe(true);
    expect(JSON.parse(decodeURIComponent(link.href.slice('vscode:mcp/install?'.length)))).toEqual({
      name: 'ri-acme-labs', type: 'http', url: team.mcpUrl, headers: { Authorization: `Bearer ${TOKEN}` },
    });
  });

  it('opens Goose with a streamable HTTP extension and its header', () => {
    const link = aiClientInstallLink('goose', personal, TOKEN)!;
    expect(link.href.startsWith('goose://extension?')).toBe(true);
    const query = params(link.href);
    expect(Object.fromEntries(query)).toMatchObject({ url: personal.mcpUrl, type: 'streamable_http', id: 'ri', name: 'Ri', timeout: '300' });
    expect(query.getAll('header')).toEqual([`Authorization=Bearer ${TOKEN}`]);
  });

  it('opens LM Studio with its base64 entry', () => {
    const link = aiClientInstallLink('lm_studio', personal, TOKEN)!;
    expect(link.href.startsWith('lmstudio://add_mcp?')).toBe(true);
    expect(decode(params(link.href).get('config')!)).toEqual({ url: personal.mcpUrl, headers: { Authorization: `Bearer ${TOKEN}` } });
  });

  it('has no link for an agent whose link would send the key to a web page, or that has none', () => {
    for (const kind of ['claude_code', 'codex', 'claude_desktop', 'gemini_cli', 'windsurf', 'opencode', 'antigravity', 'kiro', 'chatgpt', 'ri', 'other'] as const) {
      expect(aiClientInstallLink(kind, personal, TOKEN), kind).toBeNull();
    }
  });
});

describe('setup prompt', () => {
  it('tells an agent elsewhere everything it needs, with the key kept out of projects and replies', () => {
    const prompt = aiClientSetupPrompt('cursor', personal, TOKEN);
    expect(prompt).toContain('Connect Cursor on this computer to my Ri');
    expect(prompt).toContain('Server name: ri');
    expect(prompt).toContain(`Address: ${personal.mcpUrl}`);
    expect(prompt).toContain(`Authorization: Bearer ${TOKEN}`);
    expect(prompt).toContain('~/.cursor/mcp.json');
    expect(prompt).toMatch(/never in a project’s files/);
    expect(prompt).toMatch(/list my tasks/);
    expect(prompt).not.toMatch(/\n\n\n/);
  });

  it('has Claude Code run its own command with the key, which never reaches an interactive shell', () => {
    const prompt = aiClientSetupPrompt('claude_code', team, TOKEN);
    expect(prompt).toContain(`claude mcp add --transport http --scope user ri-acme-labs 'https://acme.example/api/team/mcp' --header 'Authorization: Bearer ${TOKEN}'`);
    expect(prompt).toContain('Acme Labs');
  });
});

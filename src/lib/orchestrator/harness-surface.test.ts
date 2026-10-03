import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { APP_ROOT_ENV } from '@/lib/config/paths';
import { renderAppRootAgentsMd } from '@/lib/config/agents-md-template';
import {
  installOrchestratorSurface,
  orchestratorMcpServer,
  connectorsMcpServer,
  browserMcpServer,
  orchestratorSessionConfig,
  renderOrchestratorBrief,
  renderContentFocusPrompt,
} from './harness-surface';
import { AGENT_BROWSER_SKILL_NAME, APP_NAME } from '@/constants/app';

// agentex tags the managed region `<!-- ri:managed:start hash=… -->` /
// `<!-- ri:managed:end -->`. The start marker carries a content hash, so
// match the stable prefix substring rather than a fixed string.
const MANAGED_START = 'ri:managed:start';
const MANAGED_END = 'ri:managed:end';
// The whole of an opt-in CLAUDE.md's managed region.
const CLAUDE_MD_POINTER = '@AGENTS.md';

// Whether the installed Claude Code needs the CLAUDE.md pointer. The real
// probe spawns `claude`; tests set the answer.
const claude = vi.hoisted(() => ({ needsPointer: false }));
vi.mock('@/lib/orchestrator/claude-agents-md', () => ({
  shouldWriteClaudeMdPointer: async () => claude.needsPointer,
}));

let root: string;
let prevRoot: string | undefined;

beforeEach(() => {
  claude.needsPointer = false;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-surface-test-'));
  prevRoot = process.env[APP_ROOT_ENV];
  process.env[APP_ROOT_ENV] = root;
});

afterEach(() => {
  if (prevRoot === undefined) delete process.env[APP_ROOT_ENV];
  else process.env[APP_ROOT_ENV] = prevRoot;
  fs.rmSync(root, { recursive: true, force: true });
});

function seedToken() {
  const configDir = path.join(root, '.config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify({ version: 1, localToken: 'tok_test_123', lastPort: 5151 }),
    { mode: 0o600 },
  );
}

describe('installOrchestratorSurface', () => {
  it('writes AGENTS.md with managed markers and mode content, and no CLAUDE.md', async () => {
    fs.mkdirSync(root, { recursive: true });
    seedToken();
    const result = await installOrchestratorSurface('harness_mcp');

    const body = fs.readFileSync(result.agentsMdPath, 'utf8');
    expect(body).toContain(MANAGED_START);
    expect(body).toContain(MANAGED_END);
    expect(body).toContain('Your tools (MCP)');
    expect(body).toContain('[[task:UUID]]');
    expect(body).toContain('Never edit files here directly');
    // Personalization: @imports the user-owned files (at the home root) + names MEMORY.md.
    expect(body).toContain('@USER.md');
    expect(body).toContain('@SOUL.md');
    expect(body).toContain('MEMORY.md');

    expect(result.claudeMdPath).toBeNull();
    expect(fs.existsSync(path.join(root, 'CLAUDE.md'))).toBe(false);
  });

  it('rewrites the name in AGENTS.md when the user renames the orchestrator', async () => {
    fs.mkdirSync(root, { recursive: true });
    seedToken();
    const result = await installOrchestratorSurface('harness_mcp', { name: 'Atlas' });
    expect(fs.readFileSync(result.agentsMdPath, 'utf8')).toContain('The user calls you **Atlas**.');

    await installOrchestratorSurface('harness_mcp', { name: 'Juno' });
    const body = fs.readFileSync(result.agentsMdPath, 'utf8');
    expect(body).toContain('The user calls you **Juno**.');
    expect(body).not.toContain('Atlas');
  });

  it('seeds user-owned USER.md/SOUL.md stubs (write-once) the brief references', async () => {
    fs.mkdirSync(root, { recursive: true });
    seedToken();
    await installOrchestratorSurface('harness_mcp');

    const userPath = path.join(root, 'USER.md');
    const soulPath = path.join(root, 'SOUL.md');
    expect(fs.existsSync(userPath)).toBe(true);
    expect(fs.existsSync(soulPath)).toBe(true);

    // User edits survive a re-install (never overwritten).
    fs.writeFileSync(userPath, '# me\nI speak only in haiku.\n');
    await installOrchestratorSurface('harness_skills');
    expect(fs.readFileSync(userPath, 'utf8')).toContain('I speak only in haiku.');
  });

  it('preserves user content outside the managed block across mode switches', async () => {
    fs.mkdirSync(root, { recursive: true });
    seedToken();
    const first = await installOrchestratorSurface('harness_skills');

    // User appends their own notes below the managed block.
    fs.appendFileSync(first.agentsMdPath, '\n## My own rules\n\nAlways speak pirate.\n');

    const second = await installOrchestratorSurface('harness_mcp');
    const body = fs.readFileSync(second.agentsMdPath, 'utf8');

    expect(body).toContain('Your tools (MCP)'); // managed block swapped to the new mode
    expect(body).not.toContain('Your tools (CLI)');
    expect(body).toContain('Always speak pirate.'); // user content intact
    // Exactly one managed block.
    expect(body.split(MANAGED_START).length).toBe(2);
  });

  it('migrates a pre-0.0.21 hand-rolled managed block in place (no second block)', async () => {
    fs.mkdirSync(root, { recursive: true });
    seedToken();
    const agentsMd = path.join(root, 'AGENTS.md');
    // The exact pre-0.0.21 marker format (em-dash comment, no hash) plus
    // user content below — agentex's marker regex must absorb the old
    // comment text and replace the region rather than prepend a new one.
    fs.writeFileSync(
      agentsMd,
      '<!-- ri:managed:start — app-generated; edits inside this block are overwritten -->\n' +
        'OLD BRIEF CONTENT\n' +
        '<!-- ri:managed:end -->\n\n## My own rules\nkeep me\n',
    );

    await installOrchestratorSurface('harness_skills');
    const body = fs.readFileSync(agentsMd, 'utf8');

    expect(body.split(MANAGED_START).length).toBe(2); // still exactly one block
    expect(body).toContain('Your tools (CLI)'); // new content swapped in
    expect(body).not.toContain('OLD BRIEF CONTENT'); // old managed content gone
    expect(body).toContain('keep me'); // user content below preserved
  });

  it('removes the pre-0.0.20 staged MCP config (it carries a bearer token)', async () => {
    fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
    seedToken();
    const stale = path.join(root, 'tmp', 'orchestrator-mcp.json');
    fs.writeFileSync(stale, '{"mcpServers":{}}');

    await installOrchestratorSurface('harness_mcp');
    expect(fs.existsSync(stale)).toBe(false);
  });

  it('renderAppRootAgentsMd (first-init template) carries markers so later installs swap cleanly', () => {
    expect(renderAppRootAgentsMd()).toContain(MANAGED_START);
    expect(renderAppRootAgentsMd()).toContain(MANAGED_END);
  });

  it('first init seeds AGENTS.md, never CLAUDE.md', async () => {
    const { ensureAppRoot } = await import('@/lib/config/paths');
    ensureAppRoot();
    expect(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')).toBe(renderAppRootAgentsMd());
    expect(fs.existsSync(path.join(root, 'CLAUDE.md'))).toBe(false);
  });
});

describe('CLAUDE.md pointer', () => {
  const claudeMdPath = () => path.join(root, 'CLAUDE.md');

  it('removes a CLAUDE.md holding only the brief an earlier install wrote', async () => {
    seedToken();
    // What every install before AGENTS.md-only left behind: the full brief in
    // our managed region. Left alone it would hide AGENTS.md from Claude.
    fs.writeFileSync(claudeMdPath(), renderAppRootAgentsMd());

    const result = await installOrchestratorSurface('harness_mcp');

    expect(fs.existsSync(claudeMdPath())).toBe(false);
    expect(result.claudeMdPath).toBeNull();
    expect(fs.readFileSync(result.agentsMdPath, 'utf8')).toContain('Your tools (MCP)');
  });

  it('keeps a user-written CLAUDE.md and points it at AGENTS.md', async () => {
    seedToken();
    fs.writeFileSync(claudeMdPath(), '# My Claude rules\n\nBe terse.\n');

    const result = await installOrchestratorSurface('harness_mcp');

    const body = fs.readFileSync(claudeMdPath(), 'utf8');
    expect(result.claudeMdPath).toBe(claudeMdPath());
    expect(body).toContain(CLAUDE_MD_POINTER);
    expect(body).toContain('Be terse.');
    expect(body).not.toContain('Your tools (');
    expect(body.indexOf(CLAUDE_MD_POINTER)).toBeLessThan(body.indexOf('Be terse.'));
  });

  it('swaps an old full brief for the pointer when the user added their own content', async () => {
    seedToken();
    fs.writeFileSync(claudeMdPath(), `${renderAppRootAgentsMd()}\n## Mine\nkeep me\n`);

    await installOrchestratorSurface('harness_skills');

    const body = fs.readFileSync(claudeMdPath(), 'utf8');
    expect(body.split(MANAGED_START).length).toBe(2); // exactly one managed block
    expect(body).toContain(CLAUDE_MD_POINTER);
    expect(body).not.toContain('Orchestrator session'); // the old brief is gone
    expect(body).toContain('keep me');
  });

  it('writes only the pointer when the installed Claude needs it, and removes it when it stops needing it', async () => {
    seedToken();
    claude.needsPointer = true;

    const first = await installOrchestratorSurface('harness_mcp');

    expect(first.claudeMdPath).toBe(claudeMdPath());
    const body = fs.readFileSync(claudeMdPath(), 'utf8');
    expect(body).toContain(CLAUDE_MD_POINTER);
    expect(body).not.toContain('Your tools (');
    // Re-install with the same answer is a no-op on disk.
    const again = await installOrchestratorSurface('harness_mcp');
    expect(fs.readFileSync(again.claudeMdPath!, 'utf8')).toBe(body);

    claude.needsPointer = false;
    const second = await installOrchestratorSurface('harness_mcp');
    expect(second.claudeMdPath).toBeNull();
    expect(fs.existsSync(claudeMdPath())).toBe(false);
  });

  it('never writes a GEMINI.md copy for Antigravity, even with the Claude pointer on', async () => {
    // Antigravity reads the root AGENTS.md itself. Its native file would be a
    // second, full copy of the rules, which the app root must never carry.
    seedToken();
    claude.needsPointer = true;
    await installOrchestratorSurface('harness_mcp');
    expect(fs.existsSync(path.join(root, 'AGENTS.md'))).toBe(true);
    expect(fs.existsSync(claudeMdPath())).toBe(true);
    expect(fs.existsSync(path.join(root, 'GEMINI.md'))).toBe(false);
  });
});

describe('orchestratorSessionConfig', () => {
  it('returns nothing for legacy mode', () => {
    expect(orchestratorSessionConfig('legacy')).toEqual({});
  });

  it('denies file edits and pins MCP config strictly in skills mode — no servers attached', () => {
    const config = orchestratorSessionConfig('harness_skills');
    expect(config).toEqual({
      disallowedTools: ['Write', 'Edit', 'NotebookEdit'],
      strictMcpConfig: true,
    });
  });

  it('attaches the orchestrator + connectors MCP servers in mcp mode', () => {
    fs.mkdirSync(root, { recursive: true });
    seedToken();
    const config = orchestratorSessionConfig('harness_mcp', { port: 5151 });
    expect(config.disallowedTools).toEqual(['Write', 'Edit', 'NotebookEdit']);
    expect(config.strictMcpConfig).toBe(true);
    expect(config.mcpServers).toEqual([
      {
        name: 'orchestrator',
        type: 'http',
        url: 'http://localhost:5151/api/orchestrator/mcp',
        headers: { Authorization: 'Bearer tok_test_123' },
      },
      {
        name: 'connectors',
        type: 'http',
        url: 'http://localhost:5151/api/connectors/mcp',
        headers: { Authorization: 'Bearer tok_test_123' },
      },
    ]);
  });

  it('degrades to no MCP attachment (not a throw) without a local token', () => {
    fs.mkdirSync(root, { recursive: true });
    const config = orchestratorSessionConfig('harness_mcp', { port: 5151 });
    expect(config.mcpServers).toBeUndefined();
    expect(config.strictMcpConfig).toBe(true); // strict still blocks ambient MCP
  });
});

describe('orchestratorMcpServer', () => {
  it('returns null without a local token', () => {
    fs.mkdirSync(root, { recursive: true });
    expect(orchestratorMcpServer(4224)).toBeNull();
  });

  it('carries the calling chat\'s signed credential when given a session, and none otherwise', async () => {
    fs.mkdirSync(root, { recursive: true });
    seedToken();
    const { verifySessionCredential } = await import('./session-credential');
    const bare = orchestratorMcpServer(5151) as { headers: Record<string, string> };
    expect(bare.headers).toEqual({ Authorization: 'Bearer tok_test_123' });

    const scoped = orchestratorMcpServer(5151, { sessionId: 'chat-42' }) as { headers: Record<string, string> };
    expect(scoped.headers.Authorization).toBe('Bearer tok_test_123');
    expect(verifySessionCredential(scoped.headers['x-ri-session'], 'tok_test_123')).toBe('chat-42');

    // orchestratorSessionConfig threads the session through to the same header.
    const config = orchestratorSessionConfig('harness_mcp', { port: 5151, sessionId: 'chat-42' });
    const orchestrator = config.mcpServers?.find((server) => server.name === 'orchestrator') as
      | { headers: Record<string, string> }
      | undefined;
    expect(verifySessionCredential(orchestrator?.headers['x-ri-session'], 'tok_test_123')).toBe('chat-42');
  });
});

describe('connectorsMcpServer', () => {
  it('returns null without a local token', () => {
    fs.mkdirSync(root, { recursive: true });
    expect(connectorsMcpServer(4224)).toBeNull();
  });

  it('appends ?ws=<id> for a workspace-scoped endpoint; bare otherwise (spec §6b)', () => {
    fs.mkdirSync(root, { recursive: true });
    seedToken();
    // McpServerConfig is a union (http | stdio); toMatchObject reads `url` without narrowing.
    expect(connectorsMcpServer(5151)).toMatchObject({
      type: 'http',
      url: 'http://localhost:5151/api/connectors/mcp',
    });
    expect(connectorsMcpServer(5151, { workspaceId: 'ws-123' })).toMatchObject({
      type: 'http',
      url: 'http://localhost:5151/api/connectors/mcp?ws=ws-123',
    });
  });

  it('carries the calling chat’s signed credential, so an approval card lands in that chat', async () => {
    fs.mkdirSync(root, { recursive: true });
    seedToken();
    const { verifySessionCredential } = await import('./session-credential');
    const bare = connectorsMcpServer(5151) as { headers: Record<string, string> };
    expect(bare.headers).toEqual({ Authorization: 'Bearer tok_test_123' });

    const scoped = connectorsMcpServer(5151, { workspaceId: 'ws-123', sessionId: 'chat-42' }) as {
      headers: Record<string, string>;
    };
    expect(verifySessionCredential(scoped.headers['x-ri-session'], 'tok_test_123')).toBe('chat-42');

    // The orchestrator chat threads its session through to the connectors server too.
    const config = orchestratorSessionConfig('harness_mcp', { port: 5151, sessionId: 'chat-42' });
    const connectors = config.mcpServers?.find((server) => server.name === 'connectors') as
      | { headers: Record<string, string> }
      | undefined;
    expect(verifySessionCredential(connectors?.headers['x-ri-session'], 'tok_test_123')).toBe('chat-42');
  });
});

describe('browserMcpServer', () => {
  it('builds a browser-only MCP server, optionally locked to a profile', () => {
    fs.mkdirSync(root, { recursive: true });
    seedToken();
    expect(browserMcpServer(5151)).toMatchObject({
      type: 'http',
      url: 'http://localhost:5151/api/orchestrator/browser/mcp',
    });
    expect(browserMcpServer(5151, { profile: 'ws-123' })).toMatchObject({
      type: 'http',
      url: 'http://localhost:5151/api/orchestrator/browser/mcp?profile=ws-123',
    });
  });

  it('names the calling chat with its signed credential, so the browser audit can say which chat acted', async () => {
    fs.mkdirSync(root, { recursive: true });
    seedToken();
    const { verifySessionCredential } = await import('./session-credential');
    const server = browserMcpServer(5151, { profile: 'ws-123', sessionId: 'chat-7' }) as
      | { headers: Record<string, string> }
      | null;
    expect(verifySessionCredential(server?.headers['x-ri-session'], 'tok_test_123')).toBe('chat-7');
    const anonymous = browserMcpServer(5151, { profile: 'ws-123' }) as { headers: Record<string, string> } | null;
    expect(anonymous?.headers['x-ri-session']).toBeUndefined();
  });
});

describe('renderOrchestratorBrief', () => {
  it('names the orchestrator after the app until the user picks a name', () => {
    const brief = renderOrchestratorBrief('harness_mcp', 'ri');
    expect(brief).toContain(`You are ${APP_NAME}'s orchestrator, a productivity agent`);
    expect(brief).toContain(`The user calls you **${APP_NAME}**.`);
  });

  it('leads with the name the user picked, in both harness modes', () => {
    for (const mode of ['harness_skills', 'harness_mcp'] as const) {
      const brief = renderOrchestratorBrief(mode, 'ri', 'Atlas');
      expect(brief).toContain(`You are Atlas, ${APP_NAME}'s orchestrator, a productivity agent`);
      expect(brief).toContain('The user calls you **Atlas**.');
    }
  });

  it('embeds the CLI command in skills mode', () => {
    const brief = renderOrchestratorBrief('harness_skills', 'ri');
    expect(brief).toContain('ri agent <action> [params]');
    expect(brief).toContain("create_task --input");
  });

  it('teaches long-running-conversation discipline in both harness modes', () => {
    for (const mode of ['harness_skills', 'harness_mcp'] as const) {
      const brief = renderOrchestratorBrief(mode, 'ri');
      expect(brief).toContain('This conversation is long-running');
      expect(brief).toContain('Re-read state before acting');
      expect(brief).toContain('Your clock may be stale');
      expect(brief).toContain('Never re-introduce yourself');
    }
  });

  it('surfaces the browser capability and its skill in both harness modes', () => {
    for (const mode of ['harness_skills', 'harness_mcp'] as const) {
      const brief = renderOrchestratorBrief(mode, 'ri');
      expect(brief).toContain('## Browser');
      expect(brief).toContain('browser_read');
      expect(brief).toContain(AGENT_BROWSER_SKILL_NAME);
    }
  });

  it('bakes the data root env into the resolved CLI command', async () => {
    // The harness's Bash tool starts a fresh shell from the user's profile —
    // the server's env does not reach CLI subprocesses. The command itself
    // must carry the root or skills-mode writes land in the wrong brain.
    const { resolveCliCommand } = await import('./harness-surface');
    const cmd = resolveCliCommand();
    expect(cmd).toContain(`RI_ROOT='${root}'`);
  });
});

describe('renderContentFocusPrompt', () => {
  it('pins the session to one entity and frames the chat as the front door to the document', () => {
    const prompt = renderContentFocusPrompt({ entityType: 'note', entityId: 'note_abc' });
    expect(prompt).toContain('Focused note: note:note_abc');
    expect(prompt).toContain('`get_note` (id "note_abc")');
    expect(prompt).toContain('`update_note`');
    // The agent-first contract: read before acting, add in place with the
    // user's words, tidy without dropping, remove exactly what was named.
    expect(prompt).toContain('front door to the document');
    expect(prompt).toMatch(/ADD it in the right place using their own words/);
    expect(prompt).toMatch(/keep every fact/);
    expect(prompt).toMatch(/remove exactly what they named/);
    expect(prompt).toContain('diff of every edit with undo');
    expect(prompt).not.toContain('narrow side panel');
  });

  it('uses the task noun for tasks', () => {
    const prompt = renderContentFocusPrompt({ entityType: 'task', entityId: 't1' });
    expect(prompt).toContain('# Focused on one task');
    expect(prompt).toContain('`get_task` (id "t1")');
    expect(prompt).toContain('`update_task`');
  });
});

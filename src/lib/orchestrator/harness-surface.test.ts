import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { APP_ROOT_ENV } from '@/lib/config/paths';
import { renderAppRootClaudeMd } from '@/lib/config/claude-md-template';
import {
  installOrchestratorSurface,
  orchestratorMcpServer,
  orchestratorSessionConfig,
  renderOrchestratorBrief,
} from './harness-surface';

// agentex tags the managed region `<!-- flow:managed:start hash=… -->` /
// `<!-- flow:managed:end -->`. The start marker carries a content hash, so
// match the stable prefix substring rather than a fixed string.
const MANAGED_START = 'flow:managed:start';
const MANAGED_END = 'flow:managed:end';

let root: string;
let prevRoot: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-surface-test-'));
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
  it('writes CLAUDE.md and AGENTS.md with managed markers and mode content', async () => {
    fs.mkdirSync(root, { recursive: true });
    seedToken();
    const result = await installOrchestratorSurface('harness_mcp');

    for (const p of [result.claudeMdPath, result.agentsMdPath]) {
      const body = fs.readFileSync(p, 'utf8');
      expect(body).toContain(MANAGED_START);
      expect(body).toContain(MANAGED_END);
      expect(body).toContain('Your tools (MCP)');
      expect(body).toContain('[[task:UUID]]');
      expect(body).toContain('Never edit files here directly');
      // Personalization: @imports the user-owned files (at the home root) + names MEMORY.md.
      expect(body).toContain('@USER.md');
      expect(body).toContain('@SOUL.md');
      expect(body).toContain('MEMORY.md');
    }
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
    fs.appendFileSync(first.claudeMdPath, '\n## My own rules\n\nAlways speak pirate.\n');

    const second = await installOrchestratorSurface('harness_mcp');
    const body = fs.readFileSync(second.claudeMdPath, 'utf8');

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
      '<!-- flow:managed:start — app-generated; edits inside this block are overwritten -->\n' +
        'OLD BRIEF CONTENT\n' +
        '<!-- flow:managed:end -->\n\n## My own rules\nkeep me\n',
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

  it('renderAppRootClaudeMd (first-init template) carries markers so later installs swap cleanly', () => {
    expect(renderAppRootClaudeMd()).toContain(MANAGED_START);
    expect(renderAppRootClaudeMd()).toContain(MANAGED_END);
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

  it('attaches the orchestrator MCP server in mcp mode', () => {
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
});

describe('renderOrchestratorBrief', () => {
  it('embeds the CLI command in skills mode', () => {
    const brief = renderOrchestratorBrief('harness_skills', 'flow');
    expect(brief).toContain('flow agent <action> [params]');
    expect(brief).toContain("create_task --input");
  });

  it('teaches long-running-conversation discipline in both harness modes', () => {
    for (const mode of ['harness_skills', 'harness_mcp'] as const) {
      const brief = renderOrchestratorBrief(mode, 'flow');
      expect(brief).toContain('This conversation is long-running');
      expect(brief).toContain('Re-read state before acting');
      expect(brief).toContain('Your clock may be stale');
      expect(brief).toContain('Never re-introduce yourself');
    }
  });

  it('bakes the data root env into the resolved CLI command', async () => {
    // The harness's Bash tool starts a fresh shell from the user's profile —
    // the server's env does not reach CLI subprocesses. The command itself
    // must carry the root or skills-mode writes land in the wrong brain.
    const { resolveCliCommand } = await import('./harness-surface');
    const cmd = resolveCliCommand();
    expect(cmd).toContain(`FLOW_ROOT='${root}'`);
  });
});

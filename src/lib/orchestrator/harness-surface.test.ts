import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { APP_ROOT_ENV } from '@/lib/config/paths';
import { MANAGED_START, MANAGED_END, renderAppRootClaudeMd } from '@/lib/config/claude-md-template';
import {
  installOrchestratorSurface,
  orchestratorMcpServer,
  orchestratorSessionConfig,
  renderOrchestratorBrief,
} from './harness-surface';

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
  fs.writeFileSync(
    path.join(root, 'config.json'),
    JSON.stringify({ version: 1, localToken: 'tok_test_123', lastPort: 5151 }),
    { mode: 0o600 },
  );
}

describe('installOrchestratorSurface', () => {
  it('writes CLAUDE.md and AGENTS.md with managed markers and mode content', () => {
    fs.mkdirSync(root, { recursive: true });
    seedToken();
    const result = installOrchestratorSurface('harness_mcp');

    for (const p of [result.claudeMdPath, result.agentsMdPath]) {
      const body = fs.readFileSync(p, 'utf8');
      expect(body).toContain(MANAGED_START);
      expect(body).toContain(MANAGED_END);
      expect(body).toContain('Your tools (MCP)');
      expect(body).toContain('[[task:UUID]]');
      expect(body).toContain('Never edit files here directly');
    }
  });

  it('preserves user content outside the managed block across mode switches', () => {
    fs.mkdirSync(root, { recursive: true });
    seedToken();
    const first = installOrchestratorSurface('harness_skills');

    // User appends their own notes below the managed block.
    fs.appendFileSync(first.claudeMdPath, '\n## My own rules\n\nAlways speak pirate.\n');

    const second = installOrchestratorSurface('harness_mcp');
    const body = fs.readFileSync(second.claudeMdPath, 'utf8');

    expect(body).toContain('Your tools (MCP)'); // managed block swapped to the new mode
    expect(body).not.toContain('Your tools (CLI)');
    expect(body).toContain('Always speak pirate.'); // user content intact
    // Exactly one managed block.
    expect(body.split(MANAGED_START).length).toBe(2);
  });

  it('replaces the pristine v1 write-once template instead of stacking above it', () => {
    fs.mkdirSync(root, { recursive: true });
    seedToken();
    const claudeMd = path.join(root, 'CLAUDE.md');
    // Simulate a pre-marker install: the old template, no markers.
    fs.writeFileSync(
      claudeMd,
      '# Orchestrator session\n\nold body\n\n## This is an orchestrator session, not a dev session\n\nold tail\n',
    );

    installOrchestratorSurface('harness_skills');
    const body = fs.readFileSync(claudeMd, 'utf8');
    expect(body).toContain(MANAGED_START);
    expect(body).toContain('Your tools (CLI)');
    expect(body).not.toContain('old tail');
  });

  it('removes the pre-0.0.20 staged MCP config (it carries a bearer token)', () => {
    fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
    seedToken();
    const stale = path.join(root, 'tmp', 'orchestrator-mcp.json');
    fs.writeFileSync(stale, '{"mcpServers":{}}');

    installOrchestratorSurface('harness_mcp');
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

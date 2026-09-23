import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * An agent's main chat at spawn (docs/agents-view-spec.md Phase 6): its
 * brief, what it can reach, the git write guard, and the promise that
 * nothing is written into the user's folder. Real database, real folders,
 * real local token. Nothing spawns.
 */

const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-agent-main-chat-')));
const FOLDER = path.join(ROOT, 'code', 'ri');
const REFERENCE = path.join(ROOT, 'code', 'api');
const saved = {
  root: process.env.RI_ROOT,
  db: process.env.RI_DB_PATH,
  config: process.env.RI_CONFIG_DIR,
  work: process.env.RI_WORK_DIR,
};
process.env.RI_ROOT = ROOT;
process.env.RI_CONFIG_DIR = path.join(ROOT, '.config');
process.env.RI_WORK_DIR = path.join(ROOT, '.work');
fs.mkdirSync(process.env.RI_CONFIG_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.RI_CONFIG_DIR, 'config.json'), JSON.stringify({ version: 1, localToken: 'tok_main_chat' }));
fs.mkdirSync(FOLDER, { recursive: true });
fs.mkdirSync(REFERENCE, { recursive: true });
fs.writeFileSync(path.join(FOLDER, 'README.md'), '# ri\n');

const TEST_DB = path.join(ROOT, 'data.db');

afterAll(() => {
  for (const [key, value] of [
    ['RI_ROOT', saved.root], ['RI_DB_PATH', saved.db], ['RI_CONFIG_DIR', saved.config], ['RI_WORK_DIR', saved.work],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(ROOT, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(TEST_DB + suffix, { force: true });
  process.env.RI_DB_PATH = TEST_DB;
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  getDb();
});

async function seed(overrides: Partial<{ isGit: boolean; purpose: string | null; instructions: string | null; browserEnabled: boolean }> = {}) {
  const q = await import('@/lib/db/queries');
  const ws = q.createWorkspace({
    name: 'ri',
    cwd: FOLDER,
    isGit: overrides.isGit ?? true,
    filesToCopy: [],
    status: 'active',
    browserEnabled: overrides.browserEnabled ?? true,
    purpose: overrides.purpose === undefined ? 'Ship Ri' : overrides.purpose,
    instructions: overrides.instructions === undefined ? 'Run pnpm ts before every commit.' : overrides.instructions,
  });
  const chat = q.createChatSession({ type: 'orchestration', workspaceId: ws.id, harness: 'claude', status: 'active' });
  return { q, ws, chat };
}

async function prepare(
  seeded: Awaited<ReturnType<typeof seed>>,
  opts: Partial<{ providerType: string; strictMcpIsolation: boolean; appBrowserEnabled: boolean; freshSession: boolean }> = {},
) {
  const { prepareAgentMainChatSpawn } = await import('./agent-main-chat');
  return prepareAgentMainChatSpawn({
    chatSessionId: seeded.chat.id,
    workspace: seeded.q.getWorkspace(seeded.ws.id)!,
    providerType: opts.providerType ?? 'claude',
    strictMcpIsolation: opts.strictMcpIsolation ?? true,
    appBrowserEnabled: opts.appBrowserEnabled ?? true,
    freshSession: opts.freshSession ?? true,
    port: 42241,
  });
}

function listTree(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: false }).map(String).sort();
}

describe('the brief', () => {
  it('covers the scope, role, reading tools, the git rule, the permission doctrine and provenance', async () => {
    const { renderAgentMainChatBrief } = await import('@/lib/orchestrator/harness-surface');
    const ws = { id: 'ws-1', name: 'ri', cwd: FOLDER, isGit: true, purpose: 'Ship Ri', instructions: 'Plain English.' };
    const brief = renderAgentMainChatBrief(ws);
    for (const expected of [
      '# The "ri" agent\'s main chat',
      `\`${FOLDER}\`, a git repository`,
      'Purpose: Ship Ri',
      'Plain English.',
      'manage the agent\'s work',
      'list_workspace_sessions',
      'get_session_messages',
      'search_sessions',
      '**Never edit files in this folder.**',
      'start_execution',
      'requestId',
      'Pass permission prompts to the user',
      'Answer its questions when the user\'s intent is clear',
      'labeled as\ncoming from the "ri" agent\'s main chat',
      '"ws-1"',
    ]) {
      expect(brief).toContain(expected);
    }
    // Paths are absolute: the working directory is the agent's folder, not the app's home.
    expect(brief).toContain(path.join(ROOT, 'USER.md'));
    expect(brief).toContain(path.join(ROOT, 'attachments', '<name>'));
    expect(brief).not.toContain('@USER.md');
  });

  it('lets a non-git agent act directly, and says so', async () => {
    const { renderAgentMainChatBrief } = await import('@/lib/orchestrator/harness-surface');
    const brief = renderAgentMainChatBrief({ id: 'ws-2', name: 'notes', cwd: FOLDER, isGit: false, purpose: null, instructions: null });
    expect(brief).toContain('not a git repository');
    expect(brief).toContain('you may make it here directly');
    expect(brief).not.toContain('Never edit files in this folder');
    expect(brief).toContain('Purpose: Not set yet');
    expect(brief).toContain('None yet.');
  });

  it('mentions connectors and the browser only when they are attached', async () => {
    const { renderAgentMainChatBrief } = await import('@/lib/orchestrator/harness-surface');
    const ws = { id: 'ws-1', name: 'ri', cwd: FOLDER, isGit: true, purpose: null, instructions: null };
    const bare = renderAgentMainChatBrief(ws, { connectors: false, browser: false });
    expect(bare).not.toContain('`connectors` MCP');
    expect(bare).not.toContain('## Browser');
    const full = renderAgentMainChatBrief(ws, { connectors: true, browser: true });
    expect(full).toContain('`connectors` MCP server is attached with only the external');
    expect(full).toContain('## Browser');
  });
});

describe('prepareAgentMainChatSpawn', () => {
  it('writes nothing into the agent folder, and delivers the brief from the work dir', async () => {
    const seeded = await seed();
    const before = listTree(FOLDER);
    const spawn = await prepare(seeded);
    expect(listTree(FOLDER)).toEqual(before);
    const file = spawn.config.instructionsFile!;
    expect(file.startsWith(path.join(ROOT, '.work'))).toBe(true);
    expect(file.startsWith(FOLDER)).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toContain('# The "ri" agent\'s main chat');
    expect(spawn.firstTurnPreamble).toBeNull();
  });

  it('attaches the orchestrator MCP with this chat\'s credential, isolated from ambient MCP config', async () => {
    const seeded = await seed();
    const spawn = await prepare(seeded);
    expect(spawn.config.strictMcpConfig).toBe(true);
    const orchestrator = spawn.config.mcpServers!.find((s) => s.name === 'orchestrator')!;
    const headers = (orchestrator as { headers?: Record<string, string> }).headers ?? {};
    const { verifySessionCredential } = await import('@/lib/orchestrator/session-credential');
    expect(verifySessionCredential(headers['x-ri-session'])).toBe(seeded.chat.id);
  });

  it('denies file-editing tools in a git agent and not in a plain folder', async () => {
    const git = await prepare(await seed({ isGit: true }));
    expect(git.config.disallowedTools).toEqual(expect.arrayContaining(['Write', 'Edit', 'NotebookEdit']));
    const plain = await prepare(await seed({ isGit: false }));
    expect(plain.config.disallowedTools ?? []).not.toContain('Write');
  });

  it('says the git guard is prompt-only where the harness ignores tool filtering', async () => {
    const spawn = await prepare(await seed({ isGit: true }), { providerType: 'codex' });
    expect(spawn.warnings.join('\n')).toContain('write guard is prompt-only');
    expect(fs.readFileSync(spawn.config.instructionsFile!, 'utf8')).toContain('Never edit files in this folder');
  });

  it("gets the agent's connector scopes, only where the harness isolates MCP, like its executions", async () => {
    const seeded = await seed();
    seeded.q.setWorkspaceConnectorScopes(seeded.ws.id, [{ toolkitId: 'github' }]);
    const strict = await prepare(seeded);
    const connectors = strict.config.mcpServers!.find((s) => s.name === 'connectors');
    expect(connectors).toBeTruthy();
    expect(JSON.stringify(connectors)).toContain(seeded.ws.id);
    expect(fs.readFileSync(strict.config.instructionsFile!, 'utf8')).toContain('`connectors` MCP server is attached');

    const loose = await prepare(seeded, { strictMcpIsolation: false, providerType: 'codex' });
    expect(loose.config.mcpServers!.some((s) => s.name === 'connectors')).toBe(false);
    expect(loose.warnings.join('\n')).toContain('connectors are unavailable');
  });

  it('attaches no connectors when the agent has no scopes', async () => {
    const spawn = await prepare(await seed());
    expect(spawn.config.mcpServers!.some((s) => s.name === 'connectors')).toBe(false);
  });

  it("browses with the agent's isolated profile, only when the app and the agent allow it", async () => {
    const on = await prepare(await seed({ browserEnabled: true }));
    const browser = on.config.mcpServers!.find((s) => s.name === 'browser');
    expect(browser).toBeTruthy();
    const off = await prepare(await seed({ browserEnabled: false }));
    expect(off.config.mcpServers!.some((s) => s.name === 'browser')).toBe(false);
    const appOff = await prepare(await seed({ browserEnabled: true }), { appBrowserEnabled: false });
    expect(appOff.config.mcpServers!.some((s) => s.name === 'browser')).toBe(false);
  });

  it("carries the agent's reference folders, read-only", async () => {
    const seeded = await seed();
    seeded.q.createReferenceFolder({ workspaceId: seeded.ws.id, alias: 'api', path: REFERENCE });
    const spawn = await prepare(seeded);
    expect(fs.readFileSync(spawn.config.instructionsFile!, 'utf8')).toContain(REFERENCE);
    expect(spawn.extraArgs).toEqual(expect.arrayContaining(['--add-dir', REFERENCE]));
    expect(spawn.config.disallowedTools!.some((rule) => rule.includes(REFERENCE))).toBe(true);
  });

  it('sends the brief with the first message where the harness drops session instructions', async () => {
    const seeded = await seed();
    const fresh = await prepare(seeded, { providerType: 'opencode', strictMcpIsolation: false });
    expect(fresh.config.instructionsFile).toBeUndefined();
    expect(fresh.firstTurnPreamble).toContain('# The "ri" agent\'s main chat');
    const { withFirstTurnPreamble } = await import('./agent-main-chat');
    const sent = withFirstTurnPreamble('What is running?', fresh.firstTurnPreamble);
    expect(sent.indexOf('# The "ri" agent')).toBeLessThan(sent.indexOf('What is running?'));
    expect(sent.endsWith('What is running?')).toBe(true);

    const resumed = await prepare(seeded, { providerType: 'opencode', strictMcpIsolation: false, freshSession: false });
    expect(resumed.firstTurnPreamble).toBeNull();
    expect(withFirstTurnPreamble('hi', null)).toBe('hi');
  });
});

describe('skillDirsWriteIntoCwd', () => {
  it('flags the harness that would write skills into the folder', async () => {
    const { skillDirsWriteIntoCwd } = await import('./agent-main-chat');
    expect(skillDirsWriteIntoCwd('codex')).toBe(true);
    expect(skillDirsWriteIntoCwd('claude')).toBe(false);
  });
});

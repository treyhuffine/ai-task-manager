/**
 * A team space in a process of its own, for tests of a personal home working
 * with a team (docs/homes-spec.md §9.3, P7). It marks a fresh root as a team,
 * makes its owner, and serves the real proxy and route handlers over real
 * HTTP (`home-server.ts`), so the home under test reaches it the way it
 * reaches any team: by address, with a member's key.
 *
 * Usage: `tsx src/test/fixtures/team-process.ts <root> <team name> <owner name>`.
 * It prints one JSON line, `{ url, teamId, ownerToken, ownerId }`, once it's
 * serving. `startTeamProcess` does this and waits for that line.
 */

import { getProvider } from '@agentex/agent';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import type { UnifiedTeamSeed } from './unified-home-seed';

async function main(): Promise<void> {
  const [root, teamName, ownerName] = process.argv.slice(2);
  if (!root || !teamName || !ownerName) throw new Error('usage: team-process <root> <team name> <owner name>');
  process.env.RI_ROOT = root;
  process.env.RI_CONFIG_DIR = path.join(root, '.config');
  process.env.RI_WORK_DIR = path.join(root, '.work');
  process.env.RI_DB_PATH = path.join(root, 'data.db');
  delete process.env.OPENAI_API_KEY;

  const fs = await import('node:fs');
  const stateFile = path.join(root, '.work', 'team-process-fixture.json');
  const saved = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) as { ownerToken: string; ownerId: string; workspaceId?: string; fixture?: UnifiedTeamSeed } : null;
  const { writeTeamIntent, readTeamIntent } = await import('@/lib/home/team-intent');
  if (!readTeamIntent()) writeTeamIntent({ creationId: 'team-process-create', name: teamName });
  // Fake discovery as well as execution. This fixture never inspects a real
  // signed-in harness, including while boot recovery is being registered.
  if (process.env.RI_TEST_TEAM_EXECUTION === '1') {
    const { installFakeHarness } = await import('./fake-harness');
    const { HARNESS_IDS } = await import('@/lib/harness/registry');
    for (const id of HARNESS_IDS) {
      const fake = installFakeHarness(id);
      const esmSdk = await import('@agentex/agent'); esmSdk.registerProvider(getProvider(id));
      fake.onTurn(async turn => {
        if (turn.message.includes('Ask permission')) await turn.ask({ toolName: 'Bash', toolUseId: 'http-approval', input: { command: 'pwd' } });
        if (turn.message.includes('Keep working')) await new Promise(() => {});
        await turn.say('Fake provider completed the request.');
      });
    }
    process.env.NEXT_RUNTIME = 'nodejs';
    // The actual server boot must migrate/recover before any test data writes.
    await (await import('../../../instrumentation')).register();
  }
  const { ensureHomeIdentity } = await import('@/lib/home/identity');
  const { home } = ensureHomeIdentity();
  const q = await import('@/lib/db/queries');
  const owner = saved ? { member: q.getMember(saved.ownerId)!, token: { plaintext: saved.ownerToken } }
    : q.createTeamOwner({ creationId: 'team-process-create', name: ownerName, device: { name: 'Test browser', kind: 'computer' } });
  if (!owner.member || q.memberForApiKey((await import('@/lib/auth/api-token')).lookupApiToken(owner.token.plaintext)!.key.id)?.id !== owner.member.id) throw new Error('The original fixture owner sign-in is unavailable.');
  const fixture = saved?.fixture ?? (process.env.RI_TEST_UNIFIED_HOME === '1' ? (await import('./unified-home-seed')).seedUnifiedTeam(owner.member.id) : undefined);
  let workspaceId = saved?.workspaceId;
  if (process.env.RI_TEST_TEAM_EXECUTION === '1' && !saved) {
    const { FAKE_MODEL_ID } = await import('./fake-harness');
    const cwd = path.join(root, 'shared-agent'); fs.mkdirSync(cwd, { recursive: true });
    const workspace = q.createWorkspace({ name: 'HTTP team agent', cwd, isGit: false, createdByMemberId: owner.member.id, defaultDeviceId: home.hostDeviceId });
    workspaceId = workspace.id;
    await (await import('@/lib/setups/home-context')).setHomeFolder(workspace.id, cwd);
    q.saveTeamAiSettings({ enabled: true, harness: 'claude', model: FAKE_MODEL_ID }, owner.member.id);
  }
  if (!saved) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ ownerToken: owner.token.plaintext, ownerId: owner.member.id, fixture, workspaceId }), { mode: 0o600 });
  }
  const { startHomeServer } = await import('./home-server');
  const server = await startHomeServer({ websocket: process.env.RI_TEST_HOME_WEBSOCKET === '1' });
  process.stdout.write(`${JSON.stringify({ url: server.url, teamId: home.id, ownerToken: owner.token.plaintext, ownerId: owner.member.id, fixture, workspaceId })}\n`);
  const stop = () => void server.close().finally(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

export interface TeamProcess {
  url: string;
  teamId: string;
  ownerToken: string;
  ownerId: string;
  fixture?: UnifiedTeamSeed;
  workspaceId?: string;
  stop(): Promise<void>;
}

/** Start a team in its own process and wait until it serves. */
export async function startTeamProcess(root: string, teamName = 'Acme', ownerName = 'Trey', options: { websocket?: boolean; unified?: boolean; execution?: boolean; repo?: string } = {}): Promise<TeamProcess> {
  const repo = options.repo ?? process.cwd();
  const tsx = path.join(repo, 'node_modules/.bin/tsx');
  const child: ChildProcess = spawn(tsx, [path.join(repo, 'src/test/fixtures/team-process.ts'), root, teamName, ownerName], {
    cwd: repo,
    env: { ...process.env, NODE_ENV: 'test', RI_TEST_HOME_WEBSOCKET: options.websocket ? '1' : '0', RI_TEST_UNIFIED_HOME: options.unified ? '1' : '0', RI_TEST_TEAM_EXECUTION: options.execution ? '1' : '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const ready = await new Promise<Omit<TeamProcess, 'stop'>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`The team didn't start:\n${output}`)), 60_000);
    child.stdout?.on('data', (data: Buffer) => {
      output += String(data);
      const line = output.split('\n').find((l) => l.startsWith('{'));
      if (line) {
        clearTimeout(timer);
        resolve(JSON.parse(line) as Omit<TeamProcess, 'stop'>);
      }
    });
    child.stderr?.on('data', (data: Buffer) => { output += String(data); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`The team exited (${code}) before serving:\n${output}`));
    });
  });
  return {
    ...ready,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
      }),
  };
}

if (process.argv[1]?.endsWith('team-process.ts')) {
  void main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

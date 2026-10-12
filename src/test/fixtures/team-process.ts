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

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

async function main(): Promise<void> {
  const [root, teamName, ownerName] = process.argv.slice(2);
  if (!root || !teamName || !ownerName) throw new Error('usage: team-process <root> <team name> <owner name>');
  process.env.RI_ROOT = root;
  process.env.RI_CONFIG_DIR = path.join(root, '.config');
  process.env.RI_WORK_DIR = path.join(root, '.work');
  process.env.RI_DB_PATH = path.join(root, 'data.db');
  delete process.env.OPENAI_API_KEY;

  const { writeTeamIntent } = await import('@/lib/home/team-intent');
  writeTeamIntent({ creationId: 'team-process-create', name: teamName });
  const { ensureHomeIdentity } = await import('@/lib/home/identity');
  const { home } = ensureHomeIdentity();
  const { createTeamOwner } = await import('@/lib/db/queries');
  const owner = createTeamOwner({ creationId: 'team-process-create', name: ownerName, device: { name: 'Test browser', kind: 'computer' } });
  const { startHomeServer } = await import('./home-server');
  const server = await startHomeServer();
  process.stdout.write(`${JSON.stringify({ url: server.url, teamId: home.id, ownerToken: owner.token.plaintext, ownerId: owner.member.id })}\n`);
  const stop = () => void server.close().finally(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

export interface TeamProcess {
  url: string;
  teamId: string;
  ownerToken: string;
  ownerId: string;
  stop(): Promise<void>;
}

/** Start a team in its own process and wait until it serves. */
export async function startTeamProcess(root: string, teamName = 'Acme', ownerName = 'Trey'): Promise<TeamProcess> {
  const tsx = path.resolve('node_modules/.bin/tsx');
  const child: ChildProcess = spawn(tsx, [path.resolve('src/test/fixtures/team-process.ts'), root, teamName, ownerName], {
    env: { ...process.env, NODE_ENV: 'test' },
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

/** Probe: real instrumentation register() with an unsafe runner recovery, in its own process. */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { teamTRPC } from '@/lib/spaces/remote';

async function boot(root: string, mode: 'team' | 'personal', plant: string, extra = '') {
  const repo = process.cwd();
  const osHome = path.join(root, 'os-home'); fs.mkdirSync(osHome, { recursive: true });
  const child: ChildProcess = spawn(path.join(repo, 'node_modules/.bin/tsx'), [path.join(repo, 'src/test/fixtures/unavailable-boot.ts'), root, mode, plant, extra], {
    cwd: repo, env: { ...process.env, HOME: osHome, USERPROFILE: osHome, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const ready = await new Promise<{ url: string; token: string; problem: string | null; registerMs: number; chatId: string | null; turnId: string | null }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no boot:\n${output}`)), 90_000);
    child.stdout?.on('data', (d: Buffer) => { output += String(d); const line = output.split('\n').find(l => l.startsWith('{')); if (line) { clearTimeout(timer); resolve(JSON.parse(line)); } });
    child.stderr?.on('data', (d: Buffer) => { output += String(d); });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`exited ${code}:\n${output}`)); });
  });
  return { ...ready, output: () => output, stop: () => new Promise<void>(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', () => resolve()); child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000).unref(); }) };
}

it.each(['corrupt', 'none'] as const)('a Team turn left running by a crash, booting with plant=%s', async plant => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ri-probe-boot-turn-`));
  let server: Awaited<ReturnType<typeof boot>> | undefined;
  try {
    server = await boot(root, 'team', plant, 'running-turn');
    const client = teamTRPC(server.url, server.token);
    await new Promise(resolve => setTimeout(resolve, 500));
    const status = await client.sessions.runtimeStatusGet.query({ params: { id: server.chatId! } });
    const chats = await client.team.ai.chats.list.query();
    expect(status.running).toBe(false);
    expect(status.activeTurnId).toBeNull();
    expect(status.teamTurns?.find(turn => turn.id === server!.turnId)?.status).toBe('interrupted');
    expect(chats.find(chat => chat.id === server!.chatId)?.working).toBe(false);
    expect(Boolean(server.problem)).toBe(plant === 'corrupt');
    const created = await client.tasks.create.mutate({ title: 'Content still works', rawInput: 'Content still works' });
    expect((await client.tasks.get.query({ id: created.id })).title).toBe('Content still works');
  } finally { await server?.stop(); fs.rmSync(root, { recursive: true, force: true }); }
}, 180_000);
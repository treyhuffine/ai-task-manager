/**
 * The worker's execution handlers, with the local runner stood in
 * (docs/homes-build.md, P2 protocol "Command receipt and recovery"): how each
 * kind recovers after a restart, and the placement fence.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerCommand } from '@/lib/workers/protocol';

const runner = vi.hoisted(() => ({
  send: vi.fn(async () => ({ status: 'delivered' as const })),
  abort: vi.fn(async () => {}),
  stopTask: vi.fn(async () => ({ stopped: true })),
  close: vi.fn(async () => ({ closed: true })),
  answerPendingInput: vi.fn((): { ok: false; refused?: string } => ({ ok: false })),
}));
vi.mock('@/lib/runner/local-runner', () => runner);

const scripts = vi.hoisted(() => ({ runs: 0 }));
vi.mock('@/lib/workspaces/index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/workspaces/index')>()),
  runWorktreeScript: vi.fn(async () => {
    scripts.runs += 1;
    return { ok: true, exitCode: 0, output: 'done' };
  }),
}));

const inputFiles = vi.hoisted(() => ({ fetched: [] as unknown[], fail: null as string | null }));
vi.mock('./input-files', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./input-files')>()),
  fetchInputFiles: vi.fn(async (args: { commandId: string; dir: string; files: unknown[] }) => {
    if (inputFiles.fail) throw new Error(inputFiles.fail);
    inputFiles.fetched.push({ commandId: args.commandId, dir: args.dir, files: args.files });
  }),
}));

let dir: string;
const savedConfigDir = process.env.RI_CONFIG_DIR;
const savedWorkDir = process.env.RI_WORK_DIR;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-handlers-'));
  scripts.runs = 0;
  inputFiles.fetched = [];
  inputFiles.fail = null;
  for (const fn of Object.values(runner)) fn.mockClear();
});
afterEach(() => {
  if (savedConfigDir === undefined) delete process.env.RI_CONFIG_DIR;
  else process.env.RI_CONFIG_DIR = savedConfigDir;
  if (savedWorkDir === undefined) delete process.env.RI_WORK_DIR;
  else process.env.RI_WORK_DIR = savedWorkDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

const target = { homeUrl: 'http://home', homeId: 'home-1', homeName: 'Home', computerName: 'Laptop', workerKey: 'k' };

function command(kind: WorkerCommand['kind'], payload: unknown, generation = 1, seq = 1): WorkerCommand {
  return {
    id: `cmd-${kind}-${seq}`,
    seq,
    kind,
    target: { executionId: 'exec-1', chatSessionId: 'chat-1', generation },
    actor: { source: 'human' },
    issuedAt: new Date().toISOString(),
    payload,
  };
}

async function setup(findInHistory?: (spec: unknown, message: string) => Promise<'found' | 'missing' | 'unknown'>) {
  const { CommandJournal } = await import('./command-journal');
  const { executionHandlers } = await import('./handlers');
  const journal = new CommandJournal('home-1', path.join(dir, 'commands.jsonl'));
  const handlers = executionHandlers({ journal, findInHistory: findInHistory as never });
  const ctx = (c: WorkerCommand) => ({ target, markStarted: () => journal.started(c.id) });
  return { journal, handlers, ctx };
}

const spec = { chatSessionId: 'chat-1', harness: 'claude', cwd: '/w', nativeSessionId: 'native-1' };

describe('send', () => {
  it('after a restart, counts as delivered when the message is in the native history, and never sends again', async () => {
    const { journal, handlers, ctx } = await setup(async () => 'found');
    const c = command('send', { spec, message: 'hello', turnId: 't', runId: null });
    journal.received(c);
    journal.started(c.id);
    expect(await handlers.send!.recover(c, 'started', ctx(c))).toMatchObject({ state: 'delivered' });
    expect(runner.send).not.toHaveBeenCalled();
  });

  it('after a restart, is uncertain when the message is missing or history can’t be checked', async () => {
    for (const found of ['missing', 'unknown'] as const) {
      const { handlers, ctx } = await setup(async () => found);
      const c = command('send', { spec, message: 'hello', turnId: 't', runId: null });
      expect(await handlers.send!.recover(c, 'started', ctx(c))).toMatchObject({ state: 'uncertain' });
    }
    expect(runner.send).not.toHaveBeenCalled();
  });

  it('received but never started is sent, since nothing went in', async () => {
    const { handlers, ctx } = await setup(async () => 'missing');
    const c = command('send', { spec, message: 'hello', turnId: 't', runId: null });
    expect(await handlers.send!.recover(c, 'received', ctx(c))).toMatchObject({ state: 'delivered' });
    expect(runner.send).toHaveBeenCalledOnce();
  });

  it('for a placement the home released is stale, and does nothing', async () => {
    const { journal, handlers, ctx } = await setup();
    journal.release('exec-1', 1);
    const c = command('send', { spec, message: 'released', turnId: 't', runId: null });
    journal.received(c);
    expect(await handlers.send!.recover(c, 'received', ctx(c))).toMatchObject({ state: 'stale' });
    expect(runner.send).not.toHaveBeenCalled();
  });

  it('from an earlier placement is stale, and does nothing', async () => {
    const { journal, handlers, ctx } = await setup();
    journal.received(command('interrupt', {}, 2, 1));
    const old = command('send', { spec, message: 'late', turnId: 't', runId: null }, 1, 2);
    expect(await handlers.send!.run(old, ctx(old))).toMatchObject({ state: 'stale' });
    expect(runner.send).not.toHaveBeenCalled();
  });
});

describe('a send with attached files', () => {
  const file = { fileName: '01a0d926-176a-7692-b128-cd01e081f348.png', originalName: 'photo.png', mimeType: 'image/png', size: 3, sha256: 'x' };
  const withFile = () => command('send', { spec, message: `look at [[file:${file.fileName}]]`, turnId: 't', runId: null, attachments: [file] });

  it("fetches them before anything goes in, and the harness gets this computer's path", async () => {
    process.env.RI_WORK_DIR = path.join(dir, 'work');
    const { handlers, ctx } = await setup();
    const c = withFile();
    expect(await handlers.send!.run(c, ctx(c))).toMatchObject({ state: 'delivered' });
    expect(inputFiles.fetched).toEqual([{ commandId: c.id, dir: path.join(dir, 'work', 'attachments', 'home-1', 'chat-1'), files: [file] }]);
    const placed = `look at ${path.join(dir, 'work', 'attachments', 'home-1', 'chat-1', file.fileName)}`;
    expect(runner.send).toHaveBeenCalledWith(expect.objectContaining({ message: placed }));
  });

  it("fails without starting when a file can't be brought here", async () => {
    inputFiles.fail = "Couldn't fetch photo.png from Home: photo.png is no longer at home.";
    const { journal, handlers, ctx } = await setup();
    const c = withFile();
    journal.received(c);
    expect(await handlers.send!.run(c, ctx(c))).toEqual({ state: 'failed', error: inputFiles.fail });
    expect(journal.get(c.id)?.stage).toBe('received');
    expect(runner.send).not.toHaveBeenCalled();
  });

  it('after a restart, looks for the message as the harness got it', async () => {
    process.env.RI_WORK_DIR = path.join(dir, 'work');
    const looked: string[] = [];
    const { handlers, ctx } = await setup(async (_spec, message) => {
      looked.push(message);
      return 'found';
    });
    const c = withFile();
    expect(await handlers.send!.recover(c, 'started', ctx(c))).toMatchObject({ state: 'delivered' });
    expect(looked).toEqual([`look at ${path.join(dir, 'work', 'attachments', 'home-1', 'chat-1', file.fileName)}`]);
    expect(inputFiles.fetched).toEqual([]);
  });
});

describe('the setup script', () => {
  it('is never run again after a restart that caught it running', async () => {
    const { handlers, ctx } = await setup();
    const c = command('run_script', { script: 'setup', workspaceId: 'ws', command: 'make', worktreePath: dir, branchName: null });
    expect(await handlers.run_script!.recover(c, 'started', ctx(c))).toMatchObject({ state: 'uncertain' });
    expect(scripts.runs).toBe(0);
    expect(await handlers.run_script!.recover(c, 'received', ctx(c))).toMatchObject({ state: 'delivered' });
    expect(scripts.runs).toBe(1);
  });
});

describe('prepare', () => {
  it('reuses the worktree it noted before a restart, rather than making a second', async () => {
    const { journal, handlers, ctx } = await setup();
    // The agent's folder on this computer, registered in its setup files.
    const source = path.join(dir, 'source');
    fs.mkdirSync(source);
    const { writeSetupFile } = await import('@/lib/setups/local-file');
    writeSetupFile(source, { version: 1, homeId: 'home-1', agents: { ws: { references: {} } } }, null);
    const configDir = path.join(dir, 'config');
    process.env.RI_CONFIG_DIR = configDir;
    fs.mkdirSync(configDir);
    fs.writeFileSync(path.join(configDir, 'setups.json'), JSON.stringify({ version: 1, locations: [{ dir: source, registeredAt: '' }] }));

    const worktree = path.join(dir, 'made-before-the-crash');
    fs.mkdirSync(worktree);
    const c = command('prepare', {
      workspace: { id: 'ws', name: 'Demo', isGit: true, filesToCopy: [], baseBranch: 'main', cwd: '/home/demo' },
      chatSessionId: 'chat-1',
      label: null,
      baseBranch: null,
      prNumber: null,
      live: false,
    });
    journal.received(c);
    journal.started(c.id);
    journal.note(c.id, { worktreePath: worktree, branchName: 'demo/x', baseSha: 'abc', warning: null });
    const ack = await handlers.prepare!.recover(c, 'started', ctx(c));
    expect(ack).toMatchObject({ state: 'delivered', result: { worktreePath: worktree, branchName: 'demo/x' } });
  });
});

describe('answering a prompt', () => {
  it('is stale when the prompt is no longer waiting', async () => {
    const { handlers, ctx } = await setup();
    const c = command('answer_pending_input', { requestId: 'r1', response: { allow: true } });
    expect(await handlers.answer_pending_input!.run(c, ctx(c))).toMatchObject({ state: 'stale' });
  });

  it("fails, saying why, when the runner refuses the command's actor", async () => {
    const { handlers, ctx } = await setup();
    runner.answerPendingInput.mockReturnValueOnce({ ok: false, refused: 'Only a person can approve a permission request.' });
    const c = { ...command('answer_pending_input', { requestId: 'r1', response: { allow: true } }), actor: { source: 'ai' as const, sessionId: 's' } };
    expect(await handlers.answer_pending_input!.run(c, ctx(c))).toEqual({
      state: 'failed',
      error: 'Only a person can approve a permission request.',
    });
    expect(runner.answerPendingInput).toHaveBeenCalledWith('chat-1', 'r1', { allow: true }, { source: 'ai', sessionId: 's' });
  });
});

describe('stop, interrupt, stop a task', () => {
  it('are safe to repeat after a restart', async () => {
    const { handlers, ctx } = await setup();
    for (const kind of ['interrupt', 'stop', 'stop_task'] as const) {
      const c = command(kind, kind === 'stop_task' ? { taskId: 't1' } : {});
      expect(await handlers[kind]!.recover(c, 'started', ctx(c))).toMatchObject({ state: 'delivered' });
    }
    expect(runner.abort).toHaveBeenCalledOnce();
    expect(runner.close).toHaveBeenCalledOnce();
    expect(runner.stopTask).toHaveBeenCalledWith('chat-1', 't1');
  });
});

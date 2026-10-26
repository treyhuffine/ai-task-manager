/** Actual Team tRPC operations and ordinary runner, with a fake provider. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import * as executor from '@/lib/executor/adapter';
import { settledTeamAi, stopTeamAiWork } from './chat';
import { closeAllSessions, _resetExecutorState } from '@/lib/runner/local-runner';
import { _resetHarnessProcessState, recordHarnessProcess, harnessProcessRecordPath } from '@/lib/runner/harness-processes';
import { startTeamSpace } from '@/lib/team/startup';
import { executionRecoveryProblem } from '@/lib/home/execution-startup';
vi.mock('@/lib/harness/runtime', async original => {
  const { fakeHarnessRuntime, fakeHarnessAuth } = await import('@/test/fixtures/harness-runtime');
  return { ...await original<typeof import('@/lib/harness/runtime')>(), getHarnessRuntime: fakeHarnessRuntime, resolveHarnessAuth: fakeHarnessAuth };
});
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>, fake: FakeHarness;
let owner: Awaited<ReturnType<typeof teamTrpc>>, member: Awaited<ReturnType<typeof teamTrpc>>;
const children: ChildProcess[] = [];
beforeAll(preloadTeamRoutes, 120_000);
beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1'); vi.stubGlobal('fetch', serveTeam);
  fixture = await createTeamExecutionFixture(); _resetExecutorState(); _resetHarnessProcessState();
  fake = installFakeHarness('claude'); q.saveTeamAiSettings({ harness: 'claude', model: fake.modelId }, fixture.owner.member.id);
  owner = await teamTrpc(fixture.owner.token.plaintext); member = await teamTrpc(fixture.member.token.plaintext);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
  await stopTeamAiWork({}, 'Fixture ended.').catch(() => {}); await settledTeamAi(); await closeAllSessions(); _resetExecutorState();
  fake.restore(); await fixture.cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
}, 30_000);
it('saves Team settings repeatedly despite a rejected idle close, and the next send retries it before recovering by itself', async () => {
  const chat = await owner.team.ai.chats.create.mutate({ workspaceId: fixture.workspace.id, label: 'Review recovery' });
  await member.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'review9-warmup', text: 'Hello' }); await settledTeamAi();
  const handle = fake.latest(), close = vi.spyOn(handle, 'close').mockRejectedValue(new Error('Provider shutdown failed'));
  for (const instructions of ['Owner instruction A', 'Owner instruction B']) {
    await expect(owner.workspaces.update.mutate({ params: { id: fixture.workspace.id }, body: { instructions, browserEnabled: false, isGit: false } })).resolves.toMatchObject({ instructions });
    expect(q.getWorkspace(fixture.workspace.id)?.instructions).toBe(instructions);
  }
  await expect(owner.workspaces.update.mutate({ params: { id: fixture.workspace.id }, body: { cwd: path.join(fixture.home.root, 'missing'), instructions: 'Must not save invalid configuration' } })).rejects.toThrow();
  expect(q.getWorkspace(fixture.workspace.id)?.instructions).toBe('Owner instruction B');
  const nextCwd = path.join(fixture.home.root, 'next-project'); fs.mkdirSync(nextCwd);
  await expect(owner.workspaces.update.mutate({ params: { id: fixture.workspace.id }, body: { cwd: nextCwd } })).resolves.toMatchObject({ cwd: nextCwd });
  expect(close).toHaveBeenCalledOnce(); expect(executor.hasHarnessSession(chat.id)).toBe(true);
  expect(await member.sessions.runtimeStatusGet.query({ params: { id: chat.id } })).toMatchObject({ closeUnconfirmed: true });
  // The send retries the close once itself, and refuses only because it still fails.
  await expect(member.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'review9-blocked', text: 'Must wait' })).rejects.toThrow(/^Provider shutdown failed\. Ri won't start another harness beside it\..*Try again in a moment/);
  expect(close).toHaveBeenCalledTimes(2);
  expect(q.listTeamChatTurns(chat.id)).toHaveLength(1); expect(handle.messages).toHaveLength(1);
  // Explicit controls remain strict, even though settings persistence succeeded.
  await expect(member.sessions.restartPost.mutate({ params: { id: chat.id }, body: {} })).rejects.toThrow(/shutdown|stop/i);
  expect(executor.hasUnconfirmedClose(chat.id)).toBe(true);
  close.mockRestore();
  // Once the old harness can stop, the next send confirms it and goes on. Nobody presses Restart.
  await member.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'review9-recovered', text: 'Continue' }); await settledTeamAi();
  expect(executor.hasUnconfirmedClose(chat.id)).toBe(false);
  expect(q.listTeamChatTurns(chat.id).map(turn => turn.status)).toEqual(['done', 'done']);
  expect(fake.latest()).not.toBe(handle);
  expect(fake.latest().ctx.cwd).toBe(nextCwd);
});
it('owner settings changes interrupt current member work and cancel queued work before reopening admission', async () => {
  const entered = Promise.withResolvers<void>();
  fake.onTurn(async turn => { if (turn.message.includes('Keep working')) { entered.resolve(); await new Promise(() => {}); } else await turn.say('Done'); });
  const chat = await owner.team.ai.chats.create.mutate({ workspaceId: fixture.workspace.id, label: 'Review recovery' });
  const running = await member.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'review9-running', text: 'Keep working' }); await entered.promise;
  const queued = await member.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'review9-queued', text: 'Queued work' });
  await owner.workspaces.update.mutate({ params: { id: fixture.workspace.id }, body: { instructions: 'Changed while busy' } });
  await settledTeamAi();
  expect(q.getWorkspace(fixture.workspace.id)?.instructions).toBe('Changed while busy');
  expect(q.getTeamChatTurn(running.turnId)?.status).toBe('cancelled');
  expect(q.getTeamChatTurn(queued.turnId)?.status).toBe('cancelled');
  expect(fake.sessions.flatMap(session => session.messages).some(message => message.includes('Queued work'))).toBe(false);
  await member.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'review9-fresh', text: 'Fresh configuration' }); await settledTeamAi();
  expect(q.listTeamChatTurns(chat.id).at(-1)?.status).toBe('done');
});
it('persists settings while an explicit close owns admission and joins its one failed shutdown', async () => {
  const chat = await owner.team.ai.chats.create.mutate({ workspaceId: fixture.workspace.id, label: 'Overlapping control' });
  await member.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'review9-overlap-warmup', text: 'Hello' }); await settledTeamAi();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const close = vi.spyOn(fake.latest(), 'close').mockImplementation(async () => { entered.resolve(); await release.promise; throw new Error('Overlapping shutdown failed'); });
  const restarting = member.sessions.restartPost.mutate({ params: { id: chat.id }, body: {} }).catch(error => error);
  await entered.promise;
  const saving = owner.workspaces.update.mutate({ params: { id: fixture.workspace.id }, body: { instructions: 'Saved during explicit close' } });
  try {
    await vi.waitFor(() => expect(q.getWorkspace(fixture.workspace.id)?.instructions).toBe('Saved during explicit close'));
  } finally { release.resolve(); }
  await expect(saving).resolves.toMatchObject({ instructions: 'Saved during explicit close' });
  expect(await restarting).toBeInstanceOf(Error);
  expect(close).toHaveBeenCalledOnce(); expect(executor.hasUnconfirmedClose(chat.id)).toBe(true);
});
it('quarantines a real ambiguous leftover to its chat, keeps other Team work available, and the next send clears it after exit', async () => {
  const blocked = await owner.team.ai.chats.create.mutate({ workspaceId: fixture.workspace.id, label: 'Review recovery' });
  const healthy = await owner.team.ai.chats.create.mutate({ workspaceId: fixture.workspace.id, label: 'Review recovery' });
  const child = spawn(process.execPath, ['-e', 'console.log("ready"); setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'ignore'] }); children.push(child);
  await once(child.stdout!, 'data'); await recordHarnessProcess(blocked.id, child.pid!);
  const file = harnessProcessRecordPath(), record = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Equivalent pre-upgrade observation: the recorded parent is no longer the
  // observed parent and no kernel birth proof is present. Never signal it.
  record.entries[0].process.ppid = 999999; delete record.entries[0].process.birthId;
  record.entries[0].owner.pid = 999998;
  fs.writeFileSync(file, JSON.stringify(record));
  await startTeamSpace();
  expect(executionRecoveryProblem()).toBeNull(); expect((await member.team.ai.status.query()).state).toBe('ready');
  const runtime = await member.sessions.runtimeStatusGet.query({ params: { id: blocked.id } });
  expect(runtime).toMatchObject({ closeUnconfirmed: true, closeProblem: expect.stringContaining(`pid ${child.pid} (node)`) });
  expect(() => process.kill(child.pid!, 0)).not.toThrow();
  await expect(member.team.ai.send.mutate({ chatId: blocked.id, clientSendId: 'review9-refused', text: 'No duplicate harness' })).rejects.toThrow(/inspect.*your next message checks again/);
  await member.team.ai.send.mutate({ chatId: healthy.id, clientSendId: 'review9-unrelated', text: 'Independent work' }); await settledTeamAi();
  expect(q.listTeamChatTurns(healthy.id).at(-1)?.status).toBe('done');
  expect(fake.sessions).toHaveLength(1);
  const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
  // The send itself rechecks the leftover, finds it gone and starts the harness.
  await member.team.ai.send.mutate({ chatId: blocked.id, clientSendId: 'review9-now-safe', text: 'Recovered work' }); await settledTeamAi();
  expect(await member.sessions.runtimeStatusGet.query({ params: { id: blocked.id } })).not.toHaveProperty('closeUnconfirmed');
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).entries).toEqual([]);
  expect(q.listTeamChatTurns(blocked.id).at(-1)?.status).toBe('done');
}, 20_000);

import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import type { SendPayload, WorkerCommand } from '@/lib/workers/protocol';
import * as q from '@/lib/db/queries';
import { CommandJournal } from './command-journal';
import { executionHandlers } from './handlers';
import { WorkerCommandDeferredError } from './commands';
import * as runner from '@/lib/runner/local-runner';
import { installHomeSink } from '@/lib/executor/home-sink';

let home: TestHome;
let harness: FakeHarness;
let journal: CommandJournal;
const target = { homeId: 'fixture-home', homeUrl: 'http://localhost:9', homeName: 'Home', deviceName: 'Laptop', workerKey: 'fixture' };
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-worker-admission-' });
  harness = installFakeHarness('claude');
  journal = new CommandJournal(target.homeId, path.join(home.root, 'commands.jsonl'));
  installHomeSink();
});
afterEach(async () => {
  for (const session of harness.sessions) await session.drain();
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  harness.restore();
  vi.unstubAllGlobals();
  await home.cleanup();
});
function command(coordinationAdmission: boolean): WorkerCommand {
  const chat = q.createChatSession({ harness: 'claude', type: 'content' });
  const run = q.createRun({ harness: 'claude', triggerKind: 'manual', status: 'running', chatSessionId: chat.id });
  const payload: SendPayload = {
    coordinationAdmission, message: 'Plain text from the person, no attachments.', turnId: run.id, runId: run.id, sourceEventId: 'event', attachments: [],
    spec: { chatSessionId: chat.id, harness: 'claude', cwd: home.root, sessionType: 'content', nativeSessionId: null, permissionMode: 'ask', prePlanMode: null, model: null, modelVariant: null, effort: null, mcpServers: [], strictMcpConfig: false, disallowedTools: [], extraArgs: [], instructions: null, firstTurnPreamble: null, env: {}, attachUserSkills: false, cleanLegacySkillLinks: false },
  };
  return { id: run.id, seq: 1, kind: 'send', target: { executionId: null, chatSessionId: chat.id, generation: null }, actor: { source: 'human' }, issuedAt: new Date().toISOString(), payload };
}
function execute(input: WorkerCommand) {
  return executionHandlers({ journal }).send!.run(input, { target, markStarted: () => journal.started(input.id) });
}

it('F4: supplies an ordinary human send through the real runner while the home is unreachable', async () => {
  const fetch = vi.fn(async () => { throw new TypeError('fetch failed'); });
  vi.stubGlobal('fetch', fetch);
  const input = command(false);
  journal.received(input);
  expect((await execute(input)).state).not.toBe('failed');
  expect(harness.latest().messages).toHaveLength(1);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['network', 'http500', 'html', 'malformed'] as const)('defers %s admission failure before starting, then supplies the same saved command once', async problem => {
  const fetch = vi.fn(async (): Promise<Response> => {
    if (problem === 'network') throw new TypeError('fetch failed');
    return problem === 'http500' ? new Response('Unavailable', { status: 500 }) : problem === 'html' ? new Response('<html>offline</html>') : Response.json({});
  });
  vi.stubGlobal('fetch', fetch);
  const input = command(true);
  journal.received(input);
  await expect(execute(input)).rejects.toBeInstanceOf(WorkerCommandDeferredError);
  expect(journal.get(input.id)?.stage).toBe('received');
  expect(harness.sessions).toHaveLength(0);
  fetch.mockImplementation(async () => Response.json({ allowed: true }));
  expect(await execute(input)).toEqual({ state: 'delivered' });
  expect(journal.get(input.id)?.stage).toBe('started');
  expect(harness.latest().messages).toHaveLength(1);
});

it('fails an explicit admission refusal without starting the native send', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ allowed: false, refusal: 'Assignment cancelled.' })));
  const input = command(true);
  journal.received(input);
  expect(await execute(input)).toMatchObject({ state: 'failed', error: 'Assignment cancelled.' });
  expect(harness.sessions).toHaveLength(0);
});

it('preserves the native interrupt generation fence while admission is awaiting the home', async () => {
  const input = command(true);
  let release!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { release = resolve; })));
  journal.received(input);
  const sending = execute(input);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  await runner.abort(input.target.chatSessionId!);
  release(Response.json({ allowed: true }));
  expect(await sending).toMatchObject({ state: 'failed', error: 'Interrupted before the message was sent.' });
  expect(harness.sessions).toHaveLength(0);
});

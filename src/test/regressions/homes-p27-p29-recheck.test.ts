/** Adversarial re-check of d1f472a. Assertions describe required behavior. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { getProvider } from '@agentex/agent';
import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import type { FileCandidate } from '@/lib/import/history-source';
import { WORKER_PROTOCOL } from '@/lib/workers/protocol';

let home: TestHome;
let homeId: string;
let computerId: string;
let keyId: string;
let agentId: string;
let chatId: string;
let executionId: string;
const children: ChildProcess[] = [];
const harnessPids: number[] = [];

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-p27-recheck-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  homeId = identity.ensureHomeIdentity().home.id;
  const q = await import('@/lib/db/queries');
  const grant = q.createComputerGrant({ kind: 'enroll', computerId: null, computerName: 'Review laptop', createdByApiKeyId: null });
  const enrolled = q.redeemEnrollGrant({ secret: grant.secret, name: 'Review laptop' });
  computerId = enrolled.computer.id;
  keyId = enrolled.key.id;
  agentId = q.createWorkspace({ name: 'Review', cwd: home.root, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: true }).id;
  const created = q.createExecutionWithChat({ workspaceId: agentId, harness: 'claude', label: 'Review execution' });
  chatId = created.session.id;
  executionId = created.execution.id;
  q.createPlacement({ executionId, computerId, startReason: 'created', worktreePath: home.root });
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) child.kill('SIGKILL');
  for (const pid of harnessPids.splice(0)) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* Only a process this test started. */ }
  }
  (await import('@/lib/executor/remote-live'))._resetRemoteLive();
  (await import('@/lib/workers/hub'))._resetWorkerHub();
  (await import('@/lib/worker/history'))._resetHistoryListing();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
});

const headers = () => new Headers({
  'x-ri-api-key-id': keyId, 'x-ri-api-key-type': 'computer',
  'x-ri-api-key-scope': 'worker', 'x-ri-worker-computer-id': computerId,
  'x-ri-worker-protocol': String(WORKER_PROTOCOL),
});

describe('authority at asynchronous boundaries', () => {
  it('does not restore live state if retirement lands after the helper check but before its caller resumes', async () => {
    const { POST } = await import('@/app/api/workers/me/heartbeat/route');
    const { retireWorker } = await import('@/lib/workers/retire');
    const q = await import('@/lib/db/queries');
    let release!: (body: unknown) => void;
    const json = new Promise((resolve) => { release = resolve; });
    const pending = POST({ headers: headers(), json: () => json } as unknown as NextRequest);
    // The real helper awaits json.catch(...), then the route awaits the helper.
    // Schedule another completed request in the gap between those continuations.
    void json.then(() => queueMicrotask(() => retireWorker(keyId, computerId, 'concurrent retirement')));
    release({ protocol: WORKER_PROTOCOL, version: 'review', harnesses: [], state: 'awake', live: {
      running: [chatId], pending: [], backgroundTasks: {}, generations: { [chatId]: 1 },
    } });
    const response = await pending;
    expect(q.getWorkerEnrollment(keyId)).toBeNull();
    expect.soft(response.status).toBe(401);
    expect((await import('@/lib/executor/remote-live')).listRemoteRunning()).not.toContain(chatId);
  });

  it('mints nothing without an enrollment and never verifies the old token after reenrollment', async () => {
    const q = await import('@/lib/db/queries');
    const tokens = await import('@/lib/auth/session-token');
    const input = { chatSessionId: chatId, computerId, generation: 1 };
    const old = tokens.mintSessionToken(input)!;
    expect(tokens.verifySessionToken(old)).not.toBeNull();
    (await import('@/lib/workers/retire')).retireWorker(keyId, computerId, 'off');
    expect(tokens.mintSessionToken(input)).toBeNull();
    const grant = q.createComputerGrant({ kind: 'enroll', computerId, computerName: null, createdByApiKeyId: null });
    (await import('@/lib/workers/enroll')).enrollWorker({ secret: grant.secret, name: 'New enrollment' });
    expect(tokens.verifySessionToken(old)).toBeNull();
    const fresh = tokens.mintSessionToken(input)!;
    expect(fresh).not.toBe(old);
    expect(tokens.verifySessionToken(fresh)).not.toBeNull();
  });

  it('implements the documented same-placement archive and restore token policy', async () => {
    const q = await import('@/lib/db/queries');
    const tokens = await import('@/lib/auth/session-token');
    const input = { chatSessionId: chatId, computerId, generation: 1 };
    const token = tokens.mintSessionToken(input)!;
    q.archiveExecution(executionId);
    expect(tokens.verifySessionToken(token)).toBeNull();
    q.unarchiveExecution(executionId);
    expect(tokens.mintSessionToken(input)).toBe(token);
    expect(tokens.verifySessionToken(token)).not.toBeNull();
  });
});

describe('local setup is the authority for remote reference wiring', () => {
  it.each(['cursor', 'opencode'] as const)('delivers current references in the first message of a fresh %s main chat', async (harness) => {
    const q = await import('@/lib/db/queries');
    const current = path.join(home.root, 'current-reference');
    fs.mkdirSync(current);
    q.createReferenceFolder({ workspaceId: agentId, alias: 'docs', path: current });
    (await import('@/lib/setups/local-file')).writeSetupFile(home.root, {
      version: 1, homeId, agents: { [agentId]: { references: { docs: current } } },
    }, null);
    (await import('@/lib/setups/registry')).registerLocation(home.root);
    const main = q.createChatSession({ type: 'orchestration', workspaceId: agentId, harness, status: 'active' });
    const fake = (await import('@/test/fixtures/fake-harness')).installFakeHarness(harness);
    const runner = await import('@/lib/runner/local-runner');
    (await import('@/lib/runner/sink')).installRunnerSink({ writer: { write: async () => true }, signal: () => {} });
    try {
      const spec = await (await import('@/lib/executor/session-spec')).buildSessionSpec({
        chatSessionId: main.id, harness, cwd: home.root, sessionType: 'orchestration', workspaceId: agentId,
        surfaceKind: null, surfaceRef: null, existingExternalSessionId: null, permissionMode: 'ask', prePlanMode: null,
        model: 'fake-model', modelVariant: null, effort: null,
      }, { computerId, isHome: false, generation: null });
      await runner.send({ chatSessionId: main.id, message: 'hello', turnId: 'fresh-main', runId: null, spec });
      expect(fake.latest().messages[0]).toContain(current);
      expect(fake.latest().messages[0]).toContain('hello');
    } finally {
      await runner.closeAllSessions();
      fake.restore();
      (await import('@/lib/executor/adapter'))._resetExecutorState();
    }
  });

  it('keeps the home session reference wiring in the home-built spec', async () => {
    const q = await import('@/lib/db/queries');
    const current = path.join(home.root, 'home-reference');
    fs.mkdirSync(current);
    q.createReferenceFolder({ workspaceId: agentId, alias: 'docs', path: current });
    const fake = (await import('@/test/fixtures/fake-harness')).installFakeHarness('claude');
    try {
      const spec = await (await import('@/lib/executor/session-spec')).buildSessionSpec({
        chatSessionId: chatId, harness: 'claude', cwd: home.root, sessionType: 'execution', workspaceId: agentId, executionId,
        surfaceKind: null, surfaceRef: null, existingExternalSessionId: null, permissionMode: 'ask', prePlanMode: null,
        model: 'fake-model', modelVariant: null, effort: null,
      });
      expect(spec.agentFolders).toBeUndefined();
      expect(spec.extraArgs).toContain(current);
      expect(spec.instructions).toContain(current);
    } finally { fake.restore(); }
  });

  it.each(['missing', 'duplicate'] as const)('does not wire a cached ready path when the local setup is %s', async (mode) => {
    const q = await import('@/lib/db/queries');
    const cached = path.join(home.root, 'no-longer-authorized');
    fs.mkdirSync(cached);
    q.createReferenceFolder({ workspaceId: agentId, alias: 'docs', path: cached });
    q.recordAgentSetupReports(computerId, [{ agentId, sourcePath: home.root, configRevision: null,
      status: 'ready', problem: null, references: [{ alias: 'docs', form: 'path', value: cached, path: cached, exists: true, problem: null }],
    }], { complete: true });
    const { buildSessionSpec } = await import('@/lib/executor/session-spec');
    const spec = await buildSessionSpec({ chatSessionId: chatId, harness: 'claude', cwd: home.root,
      sessionType: 'execution', workspaceId: agentId, executionId, surfaceKind: null, surfaceRef: null,
      existingExternalSessionId: null, permissionMode: 'ask', prePlanMode: null, model: 'fake-model', modelVariant: null, effort: null,
    }, { computerId, isHome: false, generation: 1 });
    expect(spec.agentFolders?.references[0]?.path).toBe(cached);
    if (mode === 'duplicate') {
      const setup = await import('@/lib/setups/local-file');
      const registry = await import('@/lib/setups/registry');
      for (const name of ['one', 'two']) {
        const dir = path.join(home.root, name);
        fs.mkdirSync(dir);
        setup.writeSetupFile(dir, { version: 1, homeId, agents: { [agentId]: { references: { docs: null } } } }, null);
        registry.registerLocation(dir);
      }
    }
    const fake = (await import('@/test/fixtures/fake-harness')).installFakeHarness('claude');
    const runner = await import('@/lib/runner/local-runner');
    (await import('@/lib/runner/sink')).installRunnerSink({ writer: { write: async () => true }, signal: () => {} });
    try {
      await runner.send({ chatSessionId: chatId, message: 'hello', turnId: 'recheck-turn', runId: null, spec });
      const config = fake.latest().ctx.config!;
      expect.soft(config.extraArgs).not.toContain(cached);
      expect(fs.readFileSync(config.instructionsFile!, 'utf8')).not.toContain(cached);
    } finally {
      await runner.closeAllSessions();
      fake.restore();
      (await import('@/lib/executor/adapter'))._resetExecutorState();
    }
  });
});

const nativeId = '22222222-2222-4222-8222-222222222222';
function transcript(texts: string[]): string {
  return texts.map((text, i) => JSON.stringify({ type: 'user', uuid: `row-${i}`, sessionId: nativeId,
    cwd: home.root, timestamp: `2026-09-20T10:00:0${i}.000Z`, isSidechain: false,
    message: { role: 'user', content: text },
  })).join('\n') + '\n';
}
async function candidate(): Promise<FileCandidate> {
  const root = path.join(home.root, 'fake-claude');
  const file = path.join(root, 'projects', 'project', `${nativeId}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, transcript(['old first', 'old second']));
  const history = getProvider('claude').localHistory!;
  const sessions = [];
  for await (const s of history.discover({ env: { CLAUDE_CONFIG_DIR: root }, mainSessionsOnly: true, requireUserMessage: true })) sessions.push(s);
  expect(sessions).toHaveLength(1);
  // Discovery records the real folder the transcript was found in (fileCandidate).
  return { kind: 'file', history, historySession: sessions[0]!, realDir: fs.realpathSync(path.dirname(sessions[0]!.transcriptPath)), key: `claude:${Buffer.from(nativeId).toString('base64url')}`,
    source: 'claude', externalSessionId: nativeId, cwd: home.root, label: 'Review', startedAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:01.000Z', branchName: null, imported: false, importStatus: 'not_imported',
  };
}
async function onlyCandidate(c: FileCandidate): Promise<void> {
  const source = await import('@/lib/import/history-source');
  vi.spyOn(source, 'discoverCandidatesInternal').mockResolvedValue({ candidates: [c],
    available: { claude: true, codex: false, opencode: false }, completed: { claude: true, codex: true, opencode: true },
  });
}

describe('pinned transcript variants', () => {
  it('retries a same-size in-place truncate/rewrite without committing the old prefix', async () => {
    const c = await candidate();
    const file = c.historySession.transcriptPath;
    const oldStat = fs.statSync(file);
    const read = c.history.read.bind(c.history);
    let replaced = false;
    let attempts = 0;
    const racing = { ...c, history: { ...c.history, async *read(session, opts) {
      attempts++;
      for await (const item of read(session, opts)) {
        yield item;
        if (!replaced) {
          replaced = true;
          fs.writeFileSync(file, transcript(['new first', 'new second']));
          expect(fs.statSync(file).ino).toBe(oldStat.ino);
          expect(fs.statSync(file).size).toBe(oldStat.size);
        }
      }
    } } } satisfies FileCandidate;
    const result = await (await import('@/lib/import/history-source')).readHistoryWindow(racing, { fromOffset: 0, expect: null, maxBytes: 1 });
    expect(attempts).toBe(2);
    expect(result.events[0]?.content).toBe('new first');
  });

  it('makes progress after a finite append during the first attempt', async () => {
    const c = await candidate();
    const read = c.history.read.bind(c.history);
    let appended = false;
    let attempts = 0;
    const racing = { ...c, history: { ...c.history, async *read(session, opts) {
      attempts++;
      for await (const item of read(session, opts)) {
        yield item;
        if (!appended) {
          appended = true;
          fs.appendFileSync(c.historySession.transcriptPath, transcript(['later']));
        }
      }
    } } } satisfies FileCandidate;
    const result = await (await import('@/lib/import/history-source')).readHistoryWindow(racing, { fromOffset: 0, expect: null, maxBytes: 1 });
    expect(attempts).toBe(2);
    expect(result.nextOffset).toBeGreaterThan(0);
    expect(result.events[0]?.content).toBe('old first');
  });

  it('does not import an unselected file through a relinked parent on the home', async () => {
    const c = await candidate();
    await onlyCandidate(c);
    const dir = path.dirname(c.historySession.transcriptPath);
    const privateDir = path.join(home.root, 'private-unselected');
    fs.mkdirSync(privateDir);
    fs.writeFileSync(path.join(privateDir, path.basename(c.historySession.transcriptPath)), transcript(['private body never selected']));
    fs.renameSync(dir, dir + '-original');
    fs.symlinkSync(privateDir, dir);
    const result = await (await import('@/lib/import/external-agents')).importExternalAgentSessions([c.key]);
    const q = await import('@/lib/db/queries');
    const contents = result.sessions.flatMap((s) => q.listChatEvents(s.chatSessionId).map((e) => e.content));
    expect.soft(result.importedSessions).toBe(0);
    expect(contents).not.toContain('private body never selected');
  });

  it('imports an unchanged local transcript across the 4 MiB commit boundary', async () => {
    const c = await candidate();
    const texts = Array.from({ length: 7 }, (_, i) => `${i}:` + 'x'.repeat(850_000));
    fs.writeFileSync(c.historySession.transcriptPath, transcript(texts));
    await onlyCandidate(c);
    const result = await (await import('@/lib/import/external-agents')).importExternalAgentSessions([c.key]);
    expect(result.importedSessions, JSON.stringify(result.failures)).toBe(1);
    const q = await import('@/lib/db/queries');
    expect(q.listChatEvents(result.sessions[0]!.chatSessionId).map((e) => e.content)).toEqual(texts);
  });
});

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for a probe process');
}

describe('process record ownership', () => {
  it('does not lose the first worker record when a second worker records the same root', async () => {
    // Fixed: a worker takes its root's lock before anything else (lock.ts,
    // runWorker), so a second one on the same root is refused before it can
    // replace the first's record. The probe starts as runWorker does.
    const file = path.join(home.root, 'worker-processes.json');
    const lockFile = path.join(home.root, 'worker.lock');
    const script = path.join(home.root, 'record-worker.ts');
    const leftoversPath = path.resolve('src/lib/worker/leftovers.ts');
    const lockPath = path.resolve('src/lib/worker/lock.ts');
    fs.writeFileSync(script, `
      import { spawn } from 'node:child_process';
      import { processRecorder, stopLeftovers } from ${JSON.stringify(leftoversPath)};
      import { acquireWorkerLock } from ${JSON.stringify(lockPath)};
      async function main() {
        try {
          await acquireWorkerLock(process.argv[3]);
        } catch {
          console.log('locked');
          process.exit(3);
        }
        await stopLeftovers(process.argv[2], 50);
        const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
        await processRecorder(process.argv[2])();
        console.log(child.pid);
        setTimeout(() => {}, 60000);
      }
      main().catch(e => { console.error(e); process.exit(1); });
    `);
    function launch(): { worker: ChildProcess; output: Promise<string> } {
      const worker = spawn(process.execPath, ['--import', 'tsx', script, file, lockFile], { stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(worker);
      const output = new Promise<string>((resolve, reject) => {
        let stderr = '';
        worker.stderr!.on('data', (chunk) => { stderr += chunk.toString(); });
        worker.once('exit', (code) => (code === 3 ? resolve('locked') : reject(new Error(`Probe worker exited ${code}: ${stderr}`))));
        worker.stdout!.once('data', (chunk: Buffer) => resolve(chunk.toString().trim()));
      });
      return { worker, output };
    }
    const first = launch();
    const harness = Number(await first.output);
    expect(Number.isInteger(harness)).toBe(true);
    harnessPids.push(harness);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).worker.pid).toBe(first.worker.pid);

    const second = launch();
    expect(await second.output).toBe('locked');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).worker.pid).toBe(first.worker.pid);

    const { processIdentity, stopLeftovers } = await import('@/lib/worker/leftovers');
    first.worker.kill('SIGKILL');
    await until(async () => !(await processIdentity(first.worker.pid!)));
    expect(await stopLeftovers(file, 200)).toEqual([harness]);
  }, 20_000);
});

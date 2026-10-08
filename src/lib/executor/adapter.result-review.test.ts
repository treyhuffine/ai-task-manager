import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const mock = vi.hoisted(() => ({
  createSession: vi.fn(), send: vi.fn(), close: vi.fn(), interrupt: vi.fn(), cleanup: vi.fn(),
  runtimeCalls: 0, planUnsupportedAt: Infinity,
}));
vi.mock('@agentex/agent', () => ({
  getProvider: () => ({ createSession: mock.createSession }),
  commandInventoryFromEvent: () => null, listInstalledSkills: async () => [],
  parseAskUserQuestion: () => null,
}));
vi.mock('@/lib/agent-skills/shipped', () => ({ removeOwnedProjectSkillLinks: mock.cleanup }));
vi.mock('@/lib/harness/model-discovery', () => ({
  getHarnessModelCatalog: async (harness: string) => [{ id: harness === 'codex' ? 'gpt-5.5' : 'opus', supportedEfforts: ['high'] }],
  resolveHarnessSelection: async (harness: string) => ({ providerId: harness,
    model: harness === 'codex' ? 'gpt-5.5' : 'opus', variant: null,
    effort: harness === 'claude' || harness === 'codex' || harness === 'antigravity' ? 'high' : null }),
}));
vi.mock('@/lib/harness/runtime', () => ({
  runtimeContextForHarness: async () => ({}),
  getHarnessRuntime: async (harness: string) => ({ capabilities: {
    sessions: { supported: true }, planMode: { supported: ++mock.runtimeCalls < mock.planUnsupportedAt },
    mcp: { supported: harness === 'claude' }, strictMcpIsolation: { supported: harness === 'claude' },
    concurrentSend: { supported: true }, modelVariants: { supported: false }, reasoningEffort: { supported: true },
  } }),
}));
vi.mock('@/lib/orchestrator/harness-surface', () => ({
  resolveCliCommand: () => 'ri', resolveServerPort: () => 0,
  installOrchestratorSurface: async () => {}, orchestratorSessionConfig: () => ({}),
  integrationsMcpServer: () => null, browserMcpServer: () => null, renderContentFocusPrompt: () => '',
}));
vi.mock('@/lib/attachments/expand-markers', () => ({ expandMarkers: async (text: string) => text }));
vi.mock('@/lib/entity-refs/expand-markers', () => ({ expandEntityMarkers: (text: string) => text }));

describe('reviewer provider startup and completion boundaries', () => {
  let root: string;
  let previous: Record<string, string | undefined>;
  let q: typeof import('@/lib/db/queries');
  let runtime: typeof import('@/lib/work-results/runtime');
  let executor: typeof import('./adapter');
  let release: (() => void) | undefined;
  const actor = { userId: 'local', source: 'human' as const };

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-review-startup-'));
    previous = Object.fromEntries(['RI_ROOT', 'RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_MIRROR_DISABLED'].map((key) => [key, process.env[key]]));
    process.env.RI_ROOT = root;
    process.env.RI_DB_PATH = path.join(root, 'data.db');
    process.env.RI_CONFIG_DIR = path.join(root, '.config');
    process.env.RI_MIRROR_DISABLED = '1';
    vi.resetModules(); vi.clearAllMocks();
    mock.runtimeCalls = 0; mock.planUnsupportedAt = Infinity;
    q = await import('@/lib/db/queries');
    runtime = await import('@/lib/work-results/runtime');
    executor = await import('./adapter');
    executor._resetExecutorState();
    (await import('@/lib/work-results/capabilities')).setWorkResultCapabilities({ handoffsEnabled: true, aiReviewEnabled: true });
    mock.send.mockResolvedValue({ result: Promise.resolve({ status: 'completed', summary: null }) });
    mock.close.mockResolvedValue(undefined); mock.interrupt.mockResolvedValue(undefined);
    mock.createSession.mockImplementation(async () => handle());
  });

  afterEach(async () => {
    release?.(); release = undefined;
    await vi.waitFor(() => expect(executor.listRunningSessions()).toHaveLength(0));
    executor._resetExecutorState();
    (await import('@/lib/db')).resetDb();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  function handle() { return { sessionId: 'provider-session', send: mock.send,
    close: mock.close, interrupt: mock.interrupt }; }
  function target() { return q.createWorkResult(actor, { requestId: 'target', body: 'Useful retained memo.' }).result; }

  it.each(['claude', 'codex', 'cursor', 'opencode', 'antigravity'] as const)(
    'loads snapshot handoff guidance on a %s reviewer without broadening its saved assignment', async (harness) => {
      q.updateUserState({ workResultGuidance: 'SHARED: Keep findings concise. Edit the deliverable if needed.' });
      const workspace = q.createWorkspace({ name: 'Reviewed work', cwd: root, isGit: false,
        instructions: 'GENERAL AGENT: Preserve project conventions.', workResultGuidance: 'AGENT HANDOFF: Include specific evidence.' });
      const source = q.createChatSession({ harness: 'claude', type: 'content', workspaceId: workspace.id });
      q.insertChatEvent({ sessionId: source.id, role: 'user', source: 'user', content: 'Inspect this saved memo.' });
      const saved = q.createWorkResult(actor, { requestId: 'instruction-target', body: 'Useful retained memo.' },
        { sourceChatSessionId: source.id }).result;
      const { review } = await runtime.requestWorkResultAiReview(actor, {
        requestId: 'instruction-review', resultId: saved.id, harness,
      });
      await vi.waitFor(() => expect(mock.send,
        q.getRun(q.getWorkResultAiReview(review.id)!.runId!)?.errorMessage ?? undefined).toHaveBeenCalledOnce());
      const call = mock.createSession.mock.calls[0][0];
      const sent = mock.send.mock.calls[0][0];
      const context = `${call.config.instructionsFile ? fs.readFileSync(call.config.instructionsFile, 'utf8') : ''}\n${sent}`;
      expect(sent.indexOf('SHARED:')).toBeLessThan(sent.indexOf('AGENT HANDOFF:'));
      expect(context).toContain('Keep findings concise.');
      expect(context).toContain('Include specific evidence.');
      expect(context).toContain('do not override app authorization');
      expect(call.config.planMode).toBe(true);
      expect(sent.endsWith(q.getWorkResultAiReview(review.id)!.brief!)).toBe(true);
      await expect(executor.dispatch(q.getWorkResultAiReview(review.id)!.reviewerSessionId!, 'Implement those changes.',
        { internalCall: true })).rejects.toMatchObject({ code: 'unsupported' });
      for (const toolName of ['ExitPlanMode', 'Write', 'Edit', 'ApplyPatch']) {
        await expect(call.onUserInputRequest({ toolName, input: {}, toolUseId: 'attempt-change' }))
          .resolves.toMatchObject({ allow: false });
      }
    },
  );

  it('closes a reviewer created after cancellation without submitting its message', async () => {
    const pending = new Promise<ReturnType<typeof handle>>((resolve) => { release = () => resolve(handle()); });
    mock.createSession.mockReturnValue(pending);
    const review = (await runtime.requestWorkResultAiReview(actor, { requestId: 'cancel-startup', resultId: target().id, harness: 'codex' })).review;
    await vi.waitFor(() => expect(mock.createSession).toHaveBeenCalledTimes(1));
    expect(q.getWorkResultAiReview(review.id)?.status).toBe('running');
    await runtime.cancelWorkResultAiReview(actor, review.id);
    release?.(); release = undefined;
    await vi.waitFor(() => expect(mock.close).toHaveBeenCalledTimes(1));
    expect(mock.send).not.toHaveBeenCalled();
    expect(q.getWorkResultAiReview(review.id)?.status).toBe('cancelled');
  });

  it('fails before spawn if read-only capability disappears during setup', async () => {
    // Request selection, final dispatch and fresh spawn each resolve runtime.
    mock.planUnsupportedAt = 3;
    const review = (await runtime.requestWorkResultAiReview(actor, { requestId: 'lost-plan', resultId: target().id, harness: 'codex' })).review;
    await vi.waitFor(() => expect(q.getWorkResultAiReview(review.id)?.status).toBe('failed'));
    expect(mock.createSession).not.toHaveBeenCalled();
    expect(mock.send).not.toHaveBeenCalled();
    expect(q.getRun(q.getWorkResultAiReview(review.id)!.runId!)?.errorMessage).toContain('read-only');
  });

  it('closes without sending when the clean reviewed checkout changes during provider startup', async () => {
    const repo = path.join(root, 'reviewed-code');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-q', repo]);
    fs.writeFileSync(path.join(repo, 'value.txt'), 'the exact saved work\n');
    execFileSync('git', ['add', 'value.txt'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'Saved target'], { cwd: repo });
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const workspace = q.createWorkspace({ name: 'Reviewed code', cwd: repo, isGit: true });
    const source = q.createChatSession({ harness: 'claude', type: 'content', workspaceId: workspace.id });
    q.insertChatEvent({ sessionId: source.id, role: 'user', source: 'user', content: 'Inspect the exact saved code.' });
    const saved = q.createWorkResult(actor, { requestId: 'saved-code', body: 'The exact clean code handoff.' }, {
      sourceChatSessionId: source.id, codeRevision: { commitSha: sha, workingTreeState: 'clean', capturedAt: new Date().toISOString() },
    }).result;
    mock.createSession.mockImplementation(async () => {
      // This is outside the original authoring runtime, so author liveness
      // alone cannot catch the change while provider setup is awaiting.
      fs.writeFileSync(path.join(repo, 'value.txt'), 'a later clean revision\n');
      execFileSync('git', ['add', 'value.txt'], { cwd: repo });
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'Changed during startup'], { cwd: repo });
      return handle();
    });
    const review = (await runtime.requestWorkResultAiReview(actor, {
      requestId: 'startup-code-change', resultId: saved.id, harness: 'codex',
    })).review;
    await vi.waitFor(() => expect(q.getWorkResultAiReview(review.id)?.statusReason).toBe('target_changed'));
    await vi.waitFor(() => expect(mock.close).toHaveBeenCalledTimes(1));
    expect(mock.send).not.toHaveBeenCalled();
    expect(q.getRun(q.getWorkResultAiReview(review.id)!.runId!)?.status).toBe('failed');
    expect(q.getWorkResultAiReview(review.id)?.scope.requested.codeRevision?.commitSha).toBe(sha);
    expect(q.getWorkResultAiReview(review.id)?.scope.observed?.drift).toBe(true);
  });

  it('preserves the inspected checkout while using host completion on a non-MCP harness', async () => {
    const skill = path.join(root, 'skills', 'user-method');
    fs.mkdirSync(skill, { recursive: true });
    fs.writeFileSync(path.join(skill, 'SKILL.md'), 'User-owned method');
    const body = '    inspected code\n\nNo actionable findings.\n';
    mock.send.mockImplementation(async () => {
      const review = q.listActiveWorkResultAiReviews()[0];
      return { result: Promise.resolve({ status: 'completed', summary: JSON.stringify({
        ri_result_review_report: 'v1', request_id: 'host-report:report', review_id: review.id, body,
      }) }) };
    });
    const review = (await runtime.requestWorkResultAiReview(actor, { requestId: 'host-report', resultId: target().id, harness: 'codex' })).review;
    await vi.waitFor(() => expect(q.getWorkResultAiReview(review.id)?.status).toBe('completed'));
    const config = mock.createSession.mock.calls[0][0].config;
    expect(config.planMode).toBe(true);
    expect(config.skillDirs).toBeUndefined();
    expect(mock.cleanup).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root, '.agents', 'skills', 'user-method'))).toBe(false);
    expect(q.getWorkResult(q.getWorkResultAiReview(review.id)!.reportResultId!)?.result.body).toBe(body);
  });

  it('does not submit preparation when the author stops during initial handle creation', async () => {
    const pending = new Promise<ReturnType<typeof handle>>((resolve) => { release = () => resolve(handle()); });
    mock.createSession.mockReturnValue(pending);
    const session = q.createChatSession({ type: 'content', harness: 'codex', model: 'gpt-5.5', effort: 'high' });
    const source = q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent', content: 'Useful unprepared memo.' })!;
    const operation = await runtime.prepareWorkResultHandoff(actor, { requestId: 'stop-startup', sourceChatSessionId: session.id, sourceEventId: source.id });
    await vi.waitFor(() => expect(mock.createSession, q.getRun(operation.runId!)?.errorMessage ?? undefined).toHaveBeenCalledTimes(1));
    await executor.abort(session.id);
    release?.(); release = undefined;
    await vi.waitFor(() => expect(executor.listRunningSessions()).toHaveLength(0));
    expect(mock.send).not.toHaveBeenCalled();
    expect(q.getRun(operation.runId!)?.status).toBe('cancelled');
    expect(q.getChatSession(session.id)?.status).toBe('active');
  });
});

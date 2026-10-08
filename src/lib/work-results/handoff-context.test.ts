import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkResultActor } from '@/db/types';

describe('signed handoff context', () => {
  let root: string;
  let previous: Record<string, string | undefined>;
  let q: typeof import('@/lib/db/queries');
  let context: typeof import('./handoff-context');
  let capabilities: typeof import('./capabilities');

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-handoff-context-'));
    previous = Object.fromEntries(['RI_ROOT', 'RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_MIRROR_DISABLED'].map((key) => [key, process.env[key]]));
    process.env.RI_ROOT = root;
    process.env.RI_DB_PATH = path.join(root, 'data.db');
    process.env.RI_CONFIG_DIR = path.join(root, '.config');
    process.env.RI_MIRROR_DISABLED = '1';
    vi.resetModules();
    q = await import('@/lib/db/queries');
    context = await import('./handoff-context');
    capabilities = await import('./capabilities');
    capabilities.setWorkResultCapabilities({ handoffsEnabled: true, aiReviewEnabled: true });
    q.updateUserState({ workResultGuidance: 'SHARED: Report meaningful verification.' });
  });

  afterEach(async () => {
    (await import('@/lib/db')).resetDb();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  function seed(workspace = true) {
    const agent = workspace ? q.createWorkspace({ name: 'Product', cwd: root, isGit: false,
      instructions: 'GENERAL: Use project conventions.', workResultGuidance: 'AGENT HANDOFF: Show the migration safety evidence.' }) : null;
    const execution = agent ? q.createExecution({ workspaceId: agent.id }) : null;
    const session = q.createChatSession({ harness: 'claude', type: execution ? 'execution' : 'content',
      workspaceId: agent?.id ?? null, executionId: execution?.id ?? null });
    const actor: WorkResultActor = { source: 'ai', userId: 'local', sessionId: session.id, executionId: execution?.id ?? null };
    return { agent, execution, session, actor };
  }

  it('resolves the producing association, ordered scoped preferences and built-in workflow', () => {
    const { actor, agent } = seed();
    q.createWorkspace({ name: 'Unrelated', cwd: root, isGit: false, workResultGuidance: 'UNRELATED: Must stay private.' });
    const resolved = context.getWorkResultHandoffContext(actor);
    expect(resolved.agent).toEqual({ id: agent!.id, name: agent!.name });
    expect(resolved.instructions.indexOf('SHARED:')).toBeLessThan(resolved.instructions.indexOf('AGENT HANDOFF:'));
    expect(resolved.instructions).toContain('current request takes precedence');
    expect(resolved.instructions).toContain('agent guidance takes precedence over shared');
    expect(resolved.instructions).toContain('do not override app authorization');
    expect(resolved.instructions).toContain('report_result');
    expect(resolved.instructions).toContain('attachment upload');
    expect(resolved.instructions).toContain('"kind":"url"');
    expect(resolved.instructions).not.toContain('UNRELATED:');
    expect(resolved.instructions).not.toContain('GENERAL:');
    expect(q.listChatEvents(actor.sessionId!)).toHaveLength(0);
  });

  it('serves shared guidance to workspace-less producers and reads changes only when context is requested', () => {
    const { actor } = seed(false);
    const old = context.getWorkResultHandoffContext(actor);
    expect(old.agentGuidance).toBeNull();
    q.updateUserState({ workResultGuidance: 'SHARED: Include actual limits.' });
    expect(old.sharedGuidance).toBe('SHARED: Report meaningful verification.');
    expect(context.getWorkResultHandoffContext(actor).sharedGuidance).toBe('SHARED: Include actual limits.');
    q.updateUserState({ workResultGuidance: null });
    const cleared = context.getWorkResultHandoffContext(actor);
    expect(cleared.sharedGuidance).toBeNull();
    expect(cleared.instructions).not.toContain('Include actual limits.');
  });

  it('requires a current signed owned producer and rejects foreign, reviewer and archived contexts', () => {
    const { actor, session } = seed();
    expect(() => context.getWorkResultHandoffContext({ source: 'human', userId: 'local' })).toThrow(/signed/);
    expect(() => context.getWorkResultHandoffContext({ ...actor, userId: 'other' })).toThrow(/unavailable/);
    expect(() => context.getWorkResultHandoffContext({ ...actor, executionId: 'claimed-other-execution' })).toThrow(/does not match/);
    q.updateChatSession(session.id, { surfaceKind: 'result_review' });
    expect(() => context.getWorkResultHandoffContext(actor)).toThrow(/active producing/);
    q.updateChatSession(session.id, { surfaceKind: null, status: 'archived' });
    expect(() => context.getWorkResultHandoffContext(actor)).toThrow(/active producing/);
  });

  it('fails closed when handoffs are disabled and never leaks shared preferences to a foreign owner', () => {
    const { actor, agent } = seed();
    capabilities.setWorkResultCapabilities({ handoffsEnabled: false });
    expect(() => context.getWorkResultHandoffContext(actor)).toThrow(/disabled/);
    const foreign = context.resolveWorkResultGuidance('other', agent);
    expect(foreign).toEqual({ sharedGuidance: null, agentGuidance: null, agent: null });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import { buildSessionSpec } from '@/lib/executor/session-spec';
import { verifySessionCredential } from '@/lib/orchestrator/session-credential';
import { writeAuthConfig } from '@/lib/auth/config-file';
import { COORDINATION_TOOLS } from './surface';
import { coordinationActions } from './actions';

const scope = vi.hoisted(() => ({ strict: true }));
vi.mock('@/lib/executor/devices', async (original) => ({ ...await original<object>(), harnessCapabilitiesOn: async () => ({ sessions: true, sessionsReason: null, concurrentSend: true, strictMcpIsolation: scope.strict, planMode: true, modelVariants: false, reasoningEffort: true }) }));

let home: TestHome;
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-coordination-tools-' });
  scope.strict = true;
  writeAuthConfig({ browserEnabled: true });
});
afterEach(async () => { await home.cleanup(); });

describe('execution coordination tools', () => {
  it.each(['claude', 'codex'] as const)('attaches signed native coordination and scoped tools on qualified %s', async (harness) => {
    const workspace = q.createWorkspace({ name: 'Project', cwd: home.root, isGit: false, browserEnabled: true, filesToCopy: [] });
    const { session } = q.createExecutionWithChat({ workspaceId: workspace.id, harness, label: 'Work' });
    const spec = await buildSessionSpec({ chatSessionId: session.id, harness, cwd: home.root, sessionType: 'execution', workspaceId: workspace.id,
      executionId: session.executionId, surfaceKind: null, surfaceRef: null, existingExternalSessionId: null,
      permissionMode: 'auto_all', prePlanMode: null, model: null, modelVariant: null, effort: null });
    expect(spec.strictMcpConfig).toBe(true);
    expect(spec.mcpServers.map(server => server.name)).toEqual(expect.arrayContaining(['coordination', 'integrations', 'browser']));
    const coordination = spec.mcpServers.find(server => server.name === 'coordination')!;
    expect(coordination).toMatchObject({ type: 'http', url: expect.stringContaining('/api/orchestrator/coordination/mcp') });
    expect(verifySessionCredential((coordination as { headers: Record<string, string> }).headers['x-ri-session'], home.token)).toBe(session.id);
    expect(spec.instructions).toContain('resumes the requesting chat automatically');
    expect(spec.instructions).toContain('message_agent');
    expect(spec.instructions).toContain('RI_SESSION_CLI');
    expect(spec.mcpServers.find(server => server.name === 'integrations')).toMatchObject({ url: expect.stringContaining(`ws=${workspace.id}`) });
    expect(spec.mcpServers.find(server => server.name === 'browser')).toMatchObject({ url: expect.stringContaining(`profile=ws-${workspace.id}`) });
  });

  it('retains the signed CLI instructions when native MCP isolation is unavailable', async () => {
    scope.strict = false;
    const { session } = q.createExecutionWithChat({ workspaceId: q.createWorkspace({ name: 'Project', cwd: home.root, isGit: false }).id, harness: 'codex', label: 'Work' });
    const spec = await buildSessionSpec({ chatSessionId: session.id, harness: 'codex', cwd: home.root, sessionType: 'execution', workspaceId: session.workspaceId,
      executionId: session.executionId, surfaceKind: null, surfaceRef: null, existingExternalSessionId: null,
      permissionMode: 'auto_all', prePlanMode: null, model: null, modelVariant: null, effort: null });
    expect(spec.mcpServers).toEqual([]);
    expect(spec.instructions).toContain('same actions are available through the signed CLI');
  });

  it('keeps native coordination focused and all coordination actions registered', async () => {
    const { actions } = await import('@/lib/orchestrator/registry');
    expect(COORDINATION_TOOLS.every(name => actions.some(action => action.name === name))).toBe(true);
    expect(coordinationActions.every(action => (COORDINATION_TOOLS as readonly string[]).includes(action.name))).toBe(true);
    for (const name of ['update_workspace', 'create_workspace', 'create_skill', 'update_heartbeat']) expect(COORDINATION_TOOLS).not.toContain(name);
  });

  it.each([true, false])('reports this execution\'s identity, stable agent address and effective MCP reach when isolation is %s', async (strict) => {
    scope.strict = strict;
    const workspace = q.createWorkspace({ name: 'Project', cwd: home.root, isGit: false, browserEnabled: true });
    const { session } = q.createExecutionWithChat({ workspaceId: workspace.id, harness: 'codex', label: 'Work' });
    const { runAction } = await import('@/lib/orchestrator/dispatch');
    expect(await runAction('get_session_context', {}, { remote: true, actor: { source: 'ai', sessionId: session.id } })).toMatchObject({
      ok: true, result: { session: { id: session.id, workspaceId: workspace.id, executionId: session.executionId },
        addresses: { self: `session:${session.id}`, agent: { address: `agent:${workspace.id}` }, orchestrator: { address: 'orchestrator' } },
        capabilities: { nativeCoordination: strict, integrations: strict, browser: strict } },
    });
  });
});

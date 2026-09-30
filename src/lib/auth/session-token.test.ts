/**
 * Session tokens (docs/homes-build.md, P2.7): what a session on a connected
 * computer uses to reach the home's servers. Accepted only while the session
 * is placed there at that generation and the computer's worker is enrolled,
 * and only for that session's own servers, in its own scope.
 */

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let home: TestHome;
let computerId: string;
let workerKeyId: string;
let agentId: string;
let executionChat: string;
let executionId: string;
let token: string;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-session-token-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  const q = await import('@/lib/db/queries');
  const grant = q.createComputerGrant({ kind: 'enroll', computerId: null, computerName: 'Laptop', createdByApiKeyId: null });
  const enrolled = q.redeemEnrollGrant({ secret: grant.secret, name: 'Laptop' });
  computerId = enrolled.computer.id;
  workerKeyId = enrolled.key.id;
  const ws = q.createWorkspace({ name: 'Demo', cwd: home.root, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: true });
  agentId = ws.id;
  const created = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'On the laptop' });
  executionChat = created.session.id;
  executionId = created.execution.id;
  q.createPlacement({ executionId, computerId, startReason: 'created' });
  const { mintSessionToken } = await import('./session-token');
  token = mintSessionToken({ chatSessionId: executionChat, computerId, generation: 1 })!;
});

afterEach(async () => {
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  await home.cleanup();
});

describe('a session token', () => {
  it('names its session while it is placed there, and nothing once it has moved', async () => {
    const { verifySessionToken } = await import('./session-token');
    expect(verifySessionToken(token)).toMatchObject({ chat: { id: executionChat }, computerId, workerApiKeyId: workerKeyId });
    const [head, signature] = [token.slice(0, token.lastIndexOf('.')), token.slice(token.lastIndexOf('.') + 1)];
    expect(verifySessionToken(`${head}.${signature.slice(1)}x`)).toBeNull();
    expect(verifySessionToken(token.replace(`.${computerId}.`, '.another-computer.'))).toBeNull();

    const q = await import('@/lib/db/queries');
    q.createPlacement({ executionId, computerId, startReason: 'continued' });
    expect(verifySessionToken(token)).toBeNull();
  });

  it('ends when the computer stops running agents for the home', async () => {
    const { verifySessionToken } = await import('./session-token');
    const q = await import('@/lib/db/queries');
    q.revokeApiKey(workerKeyId, 'Stopped local execution');
    expect(verifySessionToken(token)).toBeNull();
  });

  it("reaches only its session's own servers, each in its own scope", async () => {
    const { sessionMayReach } = await import('./session-token');
    const q = await import('@/lib/db/queries');
    const chat = q.getChatSession(executionChat)!;
    const may = (pathname: string, query = '') => sessionMayReach(chat, pathname, new URLSearchParams(query));
    expect(may('/api/connectors/mcp', `ws=${agentId}`)).toBe(true);
    expect(may('/api/connectors/mcp', 'ws=another-agent')).toBe(false);
    expect(may('/api/connectors/mcp')).toBe(false);
    expect(may('/api/orchestrator/browser/mcp', `profile=ws-${agentId}`)).toBe(true);
    expect(may('/api/orchestrator/browser/mcp')).toBe(false);
    expect(may('/api/orchestrator/browser/mcp', 'profile=default')).toBe(false);
    // An execution isn't given the orchestrator, and nothing else is a server.
    expect(may('/api/orchestrator/mcp')).toBe(false);
    expect(may('/api/tasks')).toBe(false);

    const mainChat = q.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active', permissionMode: 'ask', workspaceId: agentId } as never);
    expect(sessionMayReach(q.getChatSession(mainChat.id)!, '/api/orchestrator/mcp', new URLSearchParams())).toBe(true);
    const appChat = q.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active', permissionMode: 'ask' });
    expect(sessionMayReach(q.getChatSession(appChat.id)!, '/api/orchestrator/mcp', new URLSearchParams())).toBe(false);
  });
});

describe('the proxy, given a session token', () => {
  const request = (pathname: string, bearer: string, extra: Record<string, string> = {}) =>
    new NextRequest(`http://127.0.0.1${pathname}`, { headers: { authorization: `Bearer ${bearer}`, ...extra } });
  const passes = (res: Response) => res.headers.get('x-middleware-next') === '1';
  const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

  it("lets it through to its session's servers as that session, from elsewhere", async () => {
    const { proxy } = await import('@/proxy');
    const res = proxy(request(`/api/connectors/mcp?ws=${agentId}`, token, { 'x-ri-session-chat-id': 'forged' }));
    expect(passes(res)).toBe(true);
    expect(forwarded(res, 'x-ri-api-key-scope')).toBe('session');
    expect(forwarded(res, 'x-ri-session-chat-id')).toBe(executionChat);
    expect(forwarded(res, 'x-ri-caller-location')).toBe('elsewhere');
    expect(forwarded(res, 'x-ri-worker-computer-id')).toBe(computerId);
    expect(forwarded(res, 'x-ri-api-key-id')).toBe(workerKeyId);
  });

  it('refuses it anywhere else, and once it no longer holds', async () => {
    const { proxy } = await import('@/proxy');
    expect(proxy(request('/api/tasks', token)).status).toBe(403);
    expect(proxy(request('/api/connectors/mcp?ws=another-agent', token)).status).toBe(403);
    expect(proxy(request('/api/workers/me', token)).status).toBe(403);
    const q = await import('@/lib/db/queries');
    q.createPlacement({ executionId, computerId, startReason: 'continued' });
    expect(proxy(request(`/api/connectors/mcp?ws=${agentId}`, token)).status).toBe(401);
  });
});

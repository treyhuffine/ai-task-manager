import { beforeEach, expect, it, vi } from 'vitest';
import { initTRPC } from '@trpc/server';
import { encodeSource } from './reference';

const state = vi.hoisted(() => ({ actor: null as null | { sessionId: string }, search: vi.fn(), request: vi.fn() }));
vi.mock('@/lib/trpc/init', () => {
  const t = initTRPC.context<{ request: Request }>().create();
  return { router: t.router, viewerProcedure: t.procedure };
});
vi.mock('@/lib/server/chat-sources', () => ({ chatSourcesEnabled: () => true, chatSources: { search: state.search, resolve: async () => [{ service: 'Mail', accountLabel: 'Work', status: 'needs_access' }] } }));
vi.mock('@/lib/orchestrator/session-credential', () => ({ actorFromSessionCredential: () => state.actor, sessionCredentialFromHeaders: () => '', SESSION_CREDENTIAL_ENV: 'RI_SESSION_CREDENTIAL', SESSION_CREDENTIAL_HEADER: 'x-ri-session' }));
vi.mock('@/lib/integrations/connection-requests', () => ({ requestConnection: state.request }));
vi.mock('@/lib/db/queries', () => ({ getChatSession: () => ({ workspaceId: 'agent' }) }));
import { chatSourcesRouter } from './router';

const chatId = '01900111-1111-7111-8111-111111111111';
const caller = () => chatSourcesRouter.createCaller({ key: null, request: new Request('http://localhost') });
beforeEach(() => { state.actor = null; state.search.mockReset().mockResolvedValue({ items: [], total: 0 }); state.request.mockReset(); });
it('constructs a valid tRPC router and enforces the signed chat identity', async () => {
  expect(await caller().enabled()).toEqual({ enabled: true });
  expect(chatSourcesRouter._def.procedures).toHaveProperty('invoke');
  state.actor = { sessionId: '01900222-2222-7222-8222-222222222222' };
  await expect(caller().search({ chatId, query: '' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(state.search).not.toHaveBeenCalled();
});
it('sends an exact account pin to the native access flow without trusting labels', async () => {
  const sourceRef = encodeSource({ v: 1, kind: 'integration', toolkitId: 'mail', account: { accountId: 'same', authConfigId: 'work-client' } });
  await caller().requestAccess({ chatId, sourceRef });
  expect(state.request).toHaveBeenCalledWith(expect.objectContaining({ service: 'mail', accountPin: { accountId: 'same', authConfigId: 'work-client' }, scopeWorkspaceId: 'agent' }));
  state.actor = { sessionId: chatId };
  await expect(caller().requestAccess({ chatId, sourceRef })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(caller().openView({ chatId, sourceRef })).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

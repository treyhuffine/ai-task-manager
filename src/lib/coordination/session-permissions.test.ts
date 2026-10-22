import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { operationResponse } from '@/lib/server/operation';
import * as q from '@/lib/db/queries';

let home: TestHome;
beforeEach(async () => { home = await createTestHome({ prefix: 'ri-coord-review-patch-' }); });
afterEach(async () => { await home.cleanup(); });

it('F9: a signed agent can raise a chat it created to a broader permission mode through the generic session update', async () => {
  const source = q.createChatSession({ type: 'orchestration', harness: 'claude', permissionMode: 'ask' });
  const workspace = q.createWorkspace({ name: 'Project', cwd: home.root, isGit: false });
  const { session: child } = q.createExecutionWithChat({ workspaceId: workspace.id, harness: 'claude', permissionMode: 'ask', label: null });
  const { SESSION_CREDENTIAL_HEADER, sessionCredential } = await import('@/lib/orchestrator/session-credential');
  const request = new Request(`http://localhost/api/sessions/${child.id}`, { method: 'PATCH', headers: { [SESSION_CREDENTIAL_HEADER]: sessionCredential(source.id)! } });
  const context = { headers: request.headers, url: request.url, nextUrl: new URL(request.url), signal: request.signal };
  const op = await import('@/lib/server/operations/sessions/[id]');
  const result = await op.PATCH(op.PATCHInput.parse({ params: { id: child.id }, body: { permissionMode: 'auto_all' } }), context);
  expect(operationResponse(result).status).toBe(403);
  expect(q.getChatSession(child.id)?.permissionMode).toBe('ask');
});

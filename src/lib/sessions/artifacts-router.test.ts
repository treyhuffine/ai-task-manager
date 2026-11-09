import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import * as q from '@/lib/db/queries';
import { artifactsRouter } from './artifacts-router';
import type { RequestKey } from '@/lib/auth/request-key';
import fs from 'node:fs/promises';
import path from 'node:path';
import { filePreviewsRouter } from '@/lib/files/router';
import { createTRPCClient } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import { QueryClient } from '@tanstack/react-query';

let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
beforeEach(async () => { fixture = await createTeamExecutionFixture(); });
afterEach(async () => { await fixture.cleanup(); });

function member() {
  return artifactsRouter.createCaller({ request: new Request('http://localhost/api/trpc/artifacts'), key: {
    apiKeyId: fixture.member.key.id, scope: 'member', memberId: fixture.member.member.id,
    memberRole: 'member', location: 'home', workerDeviceId: null, sessionChatId: null,
  } });
}

it('keeps private sibling chats out of a shared execution collection', async () => {
  const shared = q.createExecutionWithChat({ workspaceId: fixture.workspace.id, harness: 'claude', label: 'Shared work', surfaceKind: q.TEAM_CHAT_SURFACE });
  const hidden = q.createExecutionChat({ executionId: shared.execution.id, harness: 'codex', label: 'Private sibling' })!;
  for (const [sessionId, file] of [[shared.session.id, 'shared.pdf'], [hidden.id, 'private.pdf']]) {
    q.insertChatEvent({ sessionId, role: 'assistant', source: 'agent', content: `[File](out/${file})` });
  }
  // Exercise the real infinite-query client, including its direction field,
  // against the real input parser rather than a permissive HTTP fixture.
  const caller = member();
  const client = createTRPCClient<typeof artifactsRouter>({ links: [() => ({ op }) => observable(observer => {
    void caller.list(op.input as Parameters<typeof caller.list>[0]).then(data => {
      observer.next({ result: { data } }); observer.complete();
    }).catch(error => observer.error(error));
  })] });
  const queries = new QueryClient();
  const options = createTRPCOptionsProxy<typeof artifactsRouter>({ client, queryClient: queries });
  const result = await queries.fetchInfiniteQuery(options.list.infiniteQueryOptions({ scope: { executionId: shared.execution.id } }, { getNextPageParam: page => page.nextCursor }));
  expect(result.pages[0]).toMatchObject({ items: [{ name: 'shared.pdf' }] });
  await expect(member().list({ scope: { sessionId: hidden.id } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

it('refuses missing resources and non-viewer credentials before returning artifacts', async () => {
  await expect(member().list({ scope: { executionId: 'missing' } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const key: RequestKey = { apiKeyId: 'worker', scope: 'worker', location: 'home', workerDeviceId: null, sessionChatId: null };
  const caller = artifactsRouter.createCaller({ request: new Request('http://localhost'), key });
  await expect(caller.list({ scope: { sessionId: 'missing' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

it('lets a member preview a listed table and refuses files from private chats', async () => {
  const shared = q.createExecutionWithChat({ workspaceId: fixture.workspace.id, harness: 'claude', label: 'Shared work', surfaceKind: q.TEAM_CHAT_SURFACE });
  const hidden = q.createExecutionChat({ executionId: shared.execution.id, harness: 'claude' })!;
  await fs.writeFile(path.join(fixture.workspace.cwd, 'data.csv'), 'Item,Quantity\nWidget,5');
  const caller = filePreviewsRouter.createCaller({ request: new Request('http://localhost/api/trpc/filePreviews'), key: {
    apiKeyId: fixture.member.key.id, scope: 'member', memberId: fixture.member.member.id,
    memberRole: 'member', location: 'home', workerDeviceId: null, sessionChatId: null,
  } });
  expect(await caller.read({ kind: 'session', sessionId: shared.session.id, path: 'data.csv' })).toMatchObject({ kind: 'table' });
  await expect(caller.read({ kind: 'session', sessionId: hidden.id, path: 'data.csv' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

/** Real native transcript reader on an isolated file, actual Team route and
 * boot reconciler. No harness process or account is used. */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import { reconcileAllSessions } from '@/lib/executor/reconcile';
import { resumeTeamAiAfterStart } from './chat';

let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
beforeAll(preloadTeamRoutes, 120_000);
afterEach(async () => { vi.unstubAllGlobals(); await fixture?.cleanup(); });

it('catches up a Team transcript through both session-open and restart recovery without replaying sends', async () => {
  fixture = await createTeamExecutionFixture(); vi.stubGlobal('fetch', serveTeam);
  const file = path.join(fixture.home.root, 'isolated-transcript.jsonl');
  const external = crypto.randomUUID();
  const line = (id: string, content: string) => JSON.stringify({ type: 'assistant', uuid: id, sessionId: external, timestamp: new Date().toISOString(), message: { id, role: 'assistant', content: [{ type: 'text', text: content }] } }) + '\n';
  fs.writeFileSync(file, line('before-restart', 'Saved on disk before restart'));
  const chat = q.createChatSession({ workspaceId: fixture.workspace.id, type: 'orchestration', harness: 'claude', surfaceKind: q.TEAM_CHAT_SURFACE,
    externalSessionId: external, externalTranscriptPath: file, externalSyncOffset: 0, deviceId: q.getHome()!.hostDeviceId });
  const member = await teamTrpc(fixture.member.token.plaintext);
  const opened = await member.sessions.reconcilePost.mutate({ params: { id: chat.id }, body: {} });
  expect(opened.replayed).toBeGreaterThan(0); expect(opened.redispatched).toBe(false);
  expect(q.listChatEvents(chat.id).some(event => event.content?.includes('Saved on disk before restart'))).toBe(true);
  fs.appendFileSync(file, line('after-restart', 'Finished while the server was down'));
  resumeTeamAiAfterStart();
  const recovered = await reconcileAllSessions({ teamOnly: true, redispatchOrphans: false });
  expect(recovered.replayed).toBeGreaterThan(0); expect(recovered.redispatched).toBe(0);
  const events = q.listChatEvents(chat.id);
  expect(events.filter(event => event.content?.includes('Finished while the server was down'))).toHaveLength(1);
  expect(events.filter(event => event.source === 'user')).toEqual([]);
});

/** Signed ordinary CLI transport, with an unreadable local DB to detect accidental access. */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { listenTeam, preloadTeamRoutes } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import { sessionCredential } from '@/lib/orchestrator/session-credential';
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
let server: Awaited<ReturnType<typeof listenTeam>>;
beforeAll(preloadTeamRoutes, 120_000);
beforeEach(async () => { fixture = await createTeamExecutionFixture(); server = await listenTeam(); });
afterEach(async () => { await server.close(); await fixture.cleanup(); vi.unstubAllEnvs(); });
it('uses live member authority over HTTP and never opens a Team session local database', async () => {
  const chat = q.createChatSession({ type: 'orchestration', surfaceKind: q.TEAM_CHAT_SURFACE, workspaceId: fixture.workspace.id, harness: 'codex', createdByMemberId: fixture.member.member.id });
  const turn = q.acceptTeamChatSend({ chatId: chat.id, memberId: fixture.member.member.id, requestingApiKeyId: fixture.member.key.id, clientSendId: 'cli-turn', text: 'Use shared tools' }); q.claimNextTeamChatTurn(chat.id);
  const root = path.join(fixture.home.root, 'cli-no-database'); fs.mkdirSync(root); fs.writeFileSync(path.join(root, 'data.db'), 'DO NOT OPEN THIS DATABASE');
  const file = path.join(root, 'call.ts');
  fs.writeFileSync(file, `import {dispatchAction} from ${JSON.stringify(path.resolve('src/cli/lib/dispatch.ts'))}; async function main(){ console.log(JSON.stringify(await dispatchAction(process.argv[2],JSON.parse(process.argv[3])))); } void main();`);
  const call = async (action: string, input = {}) => {
    const { stdout } = await promisify(execFile)(path.resolve('node_modules/.bin/tsx'), [file, action, JSON.stringify(input)], { cwd: process.cwd(), timeout: 30_000, env: { ...process.env, RI_ROOT: root, RI_DB_PATH: path.join(root, 'data.db'), RI_CONFIG_DIR: path.join(root, '.config'), RI_WORK_DIR: path.join(root, '.work'), RI_HOME_TOOLS_URL: server.url, RI_SESSION_CREDENTIAL: sessionCredential(chat.id)! } });
    return JSON.parse(stdout.trim());
  };
  expect(await call('create_task', { title: 'From ordinary CLI', idempotency_key: 'cli-write-once' })).toMatchObject({ ok: true });
  expect(q.listTasks().map(task => task.title)).toContain('From ordinary CLI');
  expect(await call('list_tasks', { status: 'active' })).toMatchObject({ ok: true });
  expect(await call('answer_pending_input', { allow: true })).toMatchObject({ ok: false });
  q.finishTeamChatTurn(turn.turn.id, 'done');
  expect(await call('list_tasks')).toMatchObject({ ok: false });
  expect(fs.readFileSync(path.join(root, 'data.db'), 'utf8')).toBe('DO NOT OPEN THIS DATABASE');
}, 90_000);

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detachedPath, prepareDevelopmentCopy } from './dev-copy';

/**
 * A development copy of a home must not be able to reach the original: not
 * its credentials, address, schedules or notification targets, not its
 * native harness sessions, and not its folders. The copy is built with the
 * real schema and real query-layer creators, so a renamed column fails here.
 */

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-dev-copy-'));
const DB = path.join(ROOT, 'data.db');
const CONFIG = path.join(ROOT, '.config');
const saved = {
  RI_ROOT: process.env.RI_ROOT,
  RI_DB_PATH: process.env.RI_DB_PATH,
  RI_CONFIG_DIR: process.env.RI_CONFIG_DIR,
};

const PROD_CWD = '/Users/someone/code/app';
const PROD_WORKTREE = '/Users/someone/ri/worktrees/app/app-abc123';

let ids: { chat: string; workspace: string; execution: string };
let ids0: { home: string; host: string };

beforeAll(async () => {
  process.env.RI_ROOT = ROOT;
  process.env.RI_DB_PATH = DB;
  process.env.RI_CONFIG_DIR = CONFIG;
  fs.mkdirSync(path.join(CONFIG, 'connectors'), { recursive: true });
  fs.mkdirSync(path.join(CONFIG, 'notifications'), { recursive: true });
  fs.writeFileSync(path.join(CONFIG, 'connectors', 'key'), 'sealing-key');
  fs.writeFileSync(path.join(CONFIG, 'notifications', 'vapid.json'), '{}');
  fs.writeFileSync(
    path.join(CONFIG, 'config.json'),
    JSON.stringify({
      version: 1,
      localToken: 'ri_live_production',
      tunnelUrl: 'https://ri-trey.beamd.run',
      autoTunnel: true,
      voiceEnabled: true,
      globalSkillEnabled: true,
    }),
  );

  const { getDb, resetDb } = await import('@/lib/db');
  const q = await import('@/lib/db/queries');
  const identity = await import('@/lib/home/identity');
  getDb();
  const original = identity.resolveHomeIdentity({ name: 'Trey' });
  ids0 = { home: original.home.id, host: original.home.hostComputerId };
  identity.resetHomeIdentityCache();
  q.createApiKey({ name: 'Phone', deviceType: 'phone' });
  const ws = q.createWorkspace({
    name: 'app',
    cwd: PROD_CWD,
    isGit: true,
    filesToCopy: [],
    collapsed: false,
    skipLiveConfirm: false,
    browserEnabled: false,
  });
  const { execution, session: chat } = q.createExecutionWithChat({
    workspaceId: ws.id,
    harness: 'claude',
    label: 'fix login',
    worktreePath: PROD_WORKTREE,
  });
  q.updateChatSession(chat.id, {
    externalSessionId: 'native-session-1',
    externalTranscriptPath: '/Users/someone/.claude/projects/x/native-session-1.jsonl',
  });
  q.createReferenceFolder({ alias: 'docs', path: '/Users/someone/docs' });
  q.createTrigger({
    name: 'morning',
    targetKind: 'orchestrator',
    harness: 'claude',
    prompt: 'X',
    kind: 'every',
    intervalSeconds: 3600,
  });
  q.createNotificationChannel({ kind: 'web_push', events: ['execution.finished'] });
  q.upsertWebPushSubscription({ endpoint: 'https://push.example/abc', auth: 'a', p256dh: 'b' });
  ids = { chat: chat.id, workspace: ws.id, execution: execution.id };
  resetDb();
});

afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('prepareDevelopmentCopy', () => {
  it('cuts every link back to the original', () => {
    const report = prepareDevelopmentCopy(ROOT);

    const config = JSON.parse(fs.readFileSync(path.join(CONFIG, 'config.json'), 'utf8'));
    expect(config.localToken).toBeNull();
    expect(config.tunnelUrl).toBeNull();
    expect(config.autoTunnel).toBe(false);
    expect(config.globalSkillEnabled).toBe(false);
    expect(config.voiceEnabled).toBe(true);
    expect(fs.existsSync(path.join(CONFIG, 'connectors'))).toBe(false);
    expect(fs.existsSync(path.join(CONFIG, 'notifications'))).toBe(false);
    expect(report.removed.sort()).toEqual(['.config/connectors', '.config/notifications']);

    const db = new Database(DB, { readonly: true });
    const one = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).get(...p) as T;
    expect(one<{ n: number }>('SELECT count(*) AS n FROM api_keys WHERE revoked_at IS NULL').n).toBe(0);
    expect(one<{ n: number }>('SELECT count(*) AS n FROM triggers WHERE enabled = 1').n).toBe(0);
    expect(one<{ n: number }>('SELECT count(*) AS n FROM notification_channels WHERE enabled = 1').n).toBe(0);
    expect(one<{ n: number }>('SELECT count(*) AS n FROM web_push_subscriptions').n).toBe(0);

    const chat = one<{ external_session_id: string | null; external_transcript_path: string | null }>(
      'SELECT external_session_id, external_transcript_path FROM chat_sessions WHERE id = ?',
      ids.chat,
    );
    expect(chat).toEqual({ external_session_id: null, external_transcript_path: null });

    const ws = one<{ cwd: string }>('SELECT cwd FROM workspaces WHERE id = ?', ids.workspace);
    expect(ws.cwd).toBe(detachedPath(ROOT, PROD_CWD));
    expect(fs.existsSync(ws.cwd)).toBe(false);
    const ex = one<{ worktree_path: string }>('SELECT worktree_path FROM executions WHERE id = ?', ids.execution);
    expect(ex.worktree_path).toBe(path.join(ROOT, '.detached', PROD_WORKTREE));
    const ref = one<{ path: string }>("SELECT path FROM reference_folders WHERE alias = 'docs'");
    expect(ref.path.endsWith('/.detached/Users/someone/docs')).toBe(true);
    db.close();
  });

  it('makes the copy a new home hosted on this machine', async () => {
    const identity = await import('@/lib/home/identity');
    const { resetDb } = await import('@/lib/db');
    resetDb();
    identity.resetHomeIdentityCache();
    const status = identity.resolveHomeIdentity();
    expect(status.state).toBe('active');
    expect(status.home.id).not.toBe(ids0.home);
    expect(status.home.name).toBe('Trey (dev copy)');
    expect(status.home.hostComputerId).not.toBe(ids0.host);
    const { getComputer } = await import('@/lib/db/queries');
    expect(getComputer(ids0.host)?.status).toBe('revoked');
    resetDb();
  });

  it('is safe to run twice', () => {
    const second = prepareDevelopmentCopy(ROOT);
    expect(second.config).toEqual([]);
    expect(second.removed).toEqual([]);
    expect(second.database['workspaces.cwd detached']).toBe(0);
    expect(second.database['api_keys revoked']).toBe(0);
    // Each run makes a fresh identity, which is what a new copy needs.
    expect(second.homeId).not.toBeNull();
  });
});

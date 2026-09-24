import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createGitFixture, createTwoComputerLayout, git } from './git';
import { createTestComputer, createTestHome, type TestHome } from './home';
import { installFakeHarness, type FakeHarness } from './fake-harness';
import { createDatabaseAt, migrationTags } from './migrations';

/**
 * The fixtures later phases rely on for connection, retry, ownership and
 * migration tests. Each is checked here against the real app, so a fixture
 * that drifts from the code it stands in for fails on its own.
 */

describe('createTestHome', () => {
  it('opens a real database under a private root and restores the environment', async () => {
    const before = process.env.RI_ROOT;
    const home = await createTestHome();
    expect(process.env.RI_DB_PATH).toBe(home.dbPath);
    const db = new Database(home.dbPath, { readonly: true });
    expect(db.prepare('SELECT count(*) AS n FROM user_state').get()).toEqual({ n: 1 });
    db.close();
    const config = JSON.parse(fs.readFileSync(path.join(home.configDir, 'config.json'), 'utf8'));
    expect(config.localToken).toBe(home.token);
    await home.cleanup();
    expect(process.env.RI_ROOT).toBe(before);
    expect(fs.existsSync(home.root)).toBe(false);
  });
});

describe('createTestComputer', () => {
  it('makes a separate root without a database or environment changes', () => {
    const before = process.env.RI_ROOT;
    const laptop = createTestComputer('laptop');
    expect(fs.existsSync(laptop.configDir)).toBe(true);
    expect(fs.existsSync(path.join(laptop.root, 'ri', 'data.db'))).toBe(false);
    expect(process.env.RI_ROOT).toBe(before);
    laptop.cleanup();
    expect(fs.existsSync(laptop.root)).toBe(false);
  });
});

describe('git fixtures', () => {
  it('pushes from one clone and fetches the exact commit in another', () => {
    const g = createGitFixture();
    try {
      const remote = g.remote('app');
      const a = g.clone(remote, path.join(g.base, 'a', 'app'));
      const b = g.clone(remote, path.join(g.base, 'b', 'app'));
      git(a, 'checkout', '-q', '-b', 'feature');
      const sha = g.commit(a, { 'src/x.ts': 'export const x = 1;\n' }, 'feature work');
      git(a, 'push', '-q', 'origin', 'feature');
      git(b, 'fetch', '-q', 'origin', 'feature');
      expect(git(b, 'rev-parse', 'origin/feature')).toBe(sha);
    } finally {
      g.cleanup();
    }
  });

  it("builds the spec's two layouts of one agent", () => {
    const layout = createTwoComputerLayout();
    try {
      expect(layout.macbook.app.endsWith('/home/dynamism/ri')).toBe(true);
      expect(layout.macbook.agentexRelative).toBe('../agentex');
      expect(layout.mini.app.endsWith('/home/ai-task-manager')).toBe(true);
      expect(layout.mini.agentexRelative).toBe('../code/agentex');
      expect(git(layout.macbook.app, 'remote', 'get-url', 'origin')).toBe(layout.appRemote);
      expect(git(layout.mini.app, 'remote', 'get-url', 'origin')).toBe(layout.appRemote);
    } finally {
      layout.cleanup();
    }
  });

  it('puts a monorepo agent in its subfolder', () => {
    const layout = createTwoComputerLayout({ monorepoSubdir: 'apps/web' });
    try {
      expect(layout.mini.app.endsWith('/ai-task-manager/apps/web')).toBe(true);
      expect(fs.existsSync(path.join(layout.mini.app, 'package.json'))).toBe(true);
      expect(layout.mini.agentexRelative).toBe('../../../code/agentex');
    } finally {
      layout.cleanup();
    }
  });
});

describe('fake harness through the real executor', () => {
  let home: TestHome | null = null;
  let fake: FakeHarness | null = null;

  afterEach(async () => {
    const { _resetExecutorState } = await import('@/lib/executor/adapter');
    const { _resetPendingInput } = await import('@/lib/executor/pending-input');
    _resetExecutorState();
    _resetPendingInput();
    fake?.restore();
    fake = null;
    await home?.cleanup();
    home = null;
  });

  async function chat(permissionMode: 'auto_all' | 'ask' = 'auto_all') {
    home = await createTestHome();
    fake = installFakeHarness('claude');
    const q = await import('@/lib/db/queries');
    return q.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active', permissionMode });
  }

  it('runs a turn: events persist and the native session id is captured', async () => {
    const session = await chat();
    const { dispatch } = await import('@/lib/executor/adapter');
    const q = await import('@/lib/db/queries');

    await dispatch(session.id, 'hello');

    const fakeSession = fake!.latest();
    expect(fakeSession.messages).toHaveLength(1);
    expect(fakeSession.ctx.cwd).toBe(home!.root);
    const events = q.listChatEvents(session.id);
    expect(events.some((e) => e.source === 'agent' && e.content === 'ok: hello')).toBe(true);
    expect(q.getChatSession(session.id)?.externalSessionId).toBe(fakeSession.sessionId);
  });

  it('resumes the same native session after the harness dies', async () => {
    const session = await chat();
    const { dispatch } = await import('@/lib/executor/adapter');
    await dispatch(session.id, 'first');
    const first = fake!.latest();
    first.crash();
    await dispatch(session.id, 'second');
    const second = fake!.latest();
    expect(second).not.toBe(first);
    expect(second.resumed).toBe(true);
    expect(second.sessionId).toBe(first.sessionId);
  });

  it('raises a permission prompt and continues once it is answered', async () => {
    const session = await chat('ask');
    const { dispatch } = await import('@/lib/executor/adapter');
    const pending = await import('@/lib/executor/pending-input');
    fake!.onTurn(async (turn) => {
      const answer = await turn.ask({ toolName: 'Bash', input: { command: 'ls' } });
      await turn.say(answer.allow ? 'allowed' : 'denied');
    });

    const turn = dispatch(session.id, 'list files');
    let requestId: string | undefined;
    for (let i = 0; i < 50 && !requestId; i++) {
      requestId = pending.listForSession(session.id)[0]?.requestId;
      if (!requestId) await new Promise((r) => setTimeout(r, 10));
    }
    expect(requestId).toBeDefined();
    pending.resolveRequest(requestId!, { allow: true, updatedInput: { command: 'ls' } });
    await turn;

    const q = await import('@/lib/db/queries');
    const sources = q.listChatEvents(session.id).map((e) => e.source);
    expect(sources).toContain('permission_request');
    expect(sources).toContain('permission_response');
    expect(q.listChatEvents(session.id).some((e) => e.content === 'allowed')).toBe(true);
  });

  it('reports an interrupted turn as aborted', async () => {
    const session = await chat();
    const { dispatch, abort } = await import('@/lib/executor/adapter');
    let started!: () => void;
    const running = new Promise<void>((r) => (started = r));
    fake!.onTurn(async (turn) => {
      started();
      await new Promise((_, reject) => turn.signal.addEventListener('abort', () => reject(turn.signal.reason)));
    });
    const turn = dispatch(session.id, 'long job');
    await running;
    await abort(session.id);
    await turn;
    expect(fake!.latest().state).toBe('idle');
  });
});

describe('migration fixtures', () => {
  it('builds a database at the baseline and upgrades it through the app', async () => {
    const tags = migrationTags();
    expect(tags.length).toBeGreaterThanOrEqual(2);
    const home = await createTestHome({ openDb: false });
    try {
      createDatabaseAt(home.dbPath, tags[0]!);
      const old = new Database(home.dbPath, { readonly: true });
      const cols = (old.prepare("PRAGMA table_info('workspaces')").all() as { name: string }[]).map((c) => c.name);
      expect(cols).not.toContain('purpose');
      old.close();

      const { getDb, getRawDb } = await import('@/lib/db');
      getDb();
      const upgraded = (getRawDb().prepare("PRAGMA table_info('workspaces')").all() as { name: string }[]).map(
        (c) => c.name,
      );
      expect(upgraded).toContain('purpose');
      const applied = getRawDb().prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number };
      expect(applied.n).toBe(tags.length);
    } finally {
      await home.cleanup();
    }
  });
});

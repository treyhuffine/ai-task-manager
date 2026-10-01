/** Exercise the actual Next development server behind the desktop controller.
 * Separate from packaged acceptance: a remote dev viewer never boots Next dev.
 * All Home, credentials and installation state live in a disposable directory.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http2 from 'node:http2';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { initDatabase } from '../src/lib/db';
import { SESSION_COOKIE_NAME } from '../src/lib/auth/session';
import { fixtureEnvironment } from './platform-qualification';
import { writeDesktopHomeIntent } from '../src/lib/service/desktop-role-intent';
import { ensureService, serviceStatus, stopService } from '../src/lib/service/client';
import { servicePaths } from '../src/lib/service/paths';
import { redactServiceLine } from '../src/lib/service/logging';

const repo = path.resolve(__dirname, '..');
const fixtureModes = process.argv.slice(2);
assert(fixtureModes.length <= 1 && fixtureModes.every(mode => ['--retired-create-only', '--retired-create-drop'].includes(mode)),
  'Use no arguments, --retired-create-only, or --retired-create-drop');
const retiredMode = fixtureModes[0];
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-desktop-dev-')));
const env: NodeJS.ProcessEnv = { ...fixtureEnvironment(process.env, { temporary }), NODE_ENV: 'development', RI_DESKTOP_MODE: 'development', NEXT_DIST_DIR: '.next-desktop-dev' };
// Prevent source .env files from restoring account credentials in this fixture.
for (const name of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CODEX_API_KEY', 'BEAMD_API_KEY']) env[name] = '';
for (const name of Object.keys(process.env)) delete process.env[name];
Object.assign(process.env, env);
fs.mkdirSync(env.HOME!, { recursive: true });
writeDesktopHomeIntent();

// Exact SQL from 45cc482:drizzle/0003_large_dark_phoenix.sql and
// df1e58a:drizzle/0004_harsh_moondragon.sql. Embedded so shallow source
// checkouts can run the regression without fetching historical commits.
const retiredMigrations = [
  { sql: "CREATE TABLE `skill_scopes` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`created_at` text DEFAULT (datetime('now')) NOT NULL,\n\t`updated_at` text DEFAULT (datetime('now')) NOT NULL,\n\t`name` text NOT NULL,\n\t`workspace_ids` text NOT NULL\n);\n--> statement-breakpoint\nCREATE UNIQUE INDEX `skill_scopes_name_unique` ON `skill_scopes` (`name`);", hash: "9122b33138438b245b95104dcbe6d4a8370fd908ed797e5dd423e90421038a21", folderMillis: 1790787209414 },
  { sql: "DROP TABLE `skill_scopes`;", hash: "fdc994186026400eeb3fcc9dcfd008aa8c0331d0affb8e2fb52645b3e375afc6", folderMillis: 1790792118119 },
];
const fixtureNoteId = '00000000-0000-4000-8000-000000000001';

function seedRetiredDatabase() {
  const source = path.join(repo, 'drizzle');
  const canonical = readMigrationFiles({ migrationsFolder: source });
  assert(canonical.length >= 4, 'The retired-history fixture needs the current replacement migration');
  const journal = JSON.parse(fs.readFileSync(path.join(source, 'meta/_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> };
  const folder = path.join(temporary, 'fixture-migrations');
  fs.mkdirSync(path.join(folder, 'meta'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: journal.entries.slice(0, 3) }));
  for (const entry of journal.entries.slice(0, 3)) fs.copyFileSync(path.join(source, `${entry.tag}.sql`), path.join(folder, `${entry.tag}.sql`));
  const db = new Database(env.RI_DB_PATH!);
  try {
    sqliteVec.load(db);
    // Raw initialization also creates real FTS indexes/triggers before the
    // representative row is inserted, without caching a getDb connection.
    initDatabase(db, folder);
    const retired = retiredMigrations.slice(0, retiredMode === '--retired-create-drop' ? 2 : 1);
    db.transaction(() => {
      for (const [index, migration] of retired.entries()) {
        assert.equal(createHash('sha256').update(migration.sql).digest('hex'), migration.hash, 'Historical fixture SQL must remain byte-exact');
        db.exec(migration.sql);
        db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(migration.hash, migration.folderMillis);
        if (index === 0) db.prepare('INSERT INTO skill_scopes (id, name, workspace_ids) VALUES (?, ?, ?)')
          .run('retired-scope', 'Keep this historical scope', '["fixture-workspace"]');
      }
      db.prepare('INSERT INTO notes (rowid, id, title, body, status) VALUES (?, ?, ?, ?, ?)')
        .run(731, fixtureNoteId, 'Historical note', 'This note must survive the retired migration bridge.', 'active');
    })();
    return {
      note: db.prepare('SELECT rowid, * FROM notes WHERE id = ?').get(fixtureNoteId),
      journal: db.prepare('SELECT rowid, * FROM __drizzle_migrations ORDER BY created_at, rowid').all(),
      expected: [...canonical.slice(0, 3), ...retired, ...canonical.slice(3)].map(migration => ({ hash: migration.hash, created_at: migration.folderMillis })),
      scope: retiredMode === '--retired-create-only' ? db.prepare('SELECT rowid, * FROM skill_scopes').get() : undefined,
    };
  } finally { db.close(); }
}

function verifyRetiredDatabase(seed: NonNullable<ReturnType<typeof seedRetiredDatabase>>) {
  const db = new Database(env.RI_DB_PATH!, { readonly: true, fileMustExist: true });
  try {
    assert.deepEqual(db.prepare('SELECT rowid, * FROM notes WHERE id = ?').get(fixtureNoteId), seed.note, 'The historical note and its rowid must survive');
    assert.deepEqual(db.prepare('SELECT rowid, * FROM __drizzle_migrations ORDER BY created_at, rowid').all().slice(0, seed.journal.length), seed.journal,
      'Original migration journal entries must not be rewritten or removed');
    assert.deepEqual(db.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at, rowid').all(), seed.expected,
      'Only pending canonical migrations should be appended');
    const hasScope = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='skill_scopes'").get();
    assert.equal(hasScope, retiredMode === '--retired-create-only');
    if (hasScope) assert.deepEqual(db.prepare('SELECT rowid, * FROM skill_scopes').get(), seed.scope, 'Historical scope data must not be dropped');
    assert(db.prepare("SELECT name FROM pragma_table_info('user_state') WHERE name='execution_inactive_after_days'").get(), 'The current canonical migration must apply');
    console.info('Passed: historical journal, note rowid and retained scope data survive the migration bridge');
  } finally { db.close(); }
}

async function main() {
  let seeded: ReturnType<typeof seedRetiredDatabase> | undefined;
  let client: http2.ClientHttp2Session | undefined;
  let sessionToken: string | undefined;
  const log = servicePaths().log;
  try {
    assert.equal(await serviceStatus(), null, 'A fresh fixture must never attach to an existing Home');
    if (retiredMode) seeded = seedRetiredDatabase();
    const session = await ensureService({ repo, node: process.execPath, env });
    sessionToken = session.token;
    assert.equal(session.phase, 'running');
    assert.equal(session.identity.root, env.RI_ROOT);
    client = http2.connect(session.origin, { ca: session.certificate, allowPartialTrustChain: true });
    const connected = client;
    await new Promise<void>((resolve, reject) => { connected.once('connect', resolve); connected.once('error', reject); });
    assert.equal(connected.alpnProtocol, 'h2');
    const request = (pathname: string, options: { method?: 'GET' | 'POST'; body?: string } = {}) => new Promise<{ status: number; body: string; location?: string; cookies: string[] }>((resolve, reject) => {
      const stream = connected.request({ ':path': pathname, ':method': options.method ?? 'GET', authorization: `Bearer ${session.token}`,
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}) });
      let status = 0;
      let location: string | undefined;
      let cookies: string[] = [];
      let body = '';
      stream.setEncoding('utf8');
      stream.setTimeout(120_000, () => stream.destroy(new Error(`Development request timed out: ${pathname}`)));
      stream.on('response', headers => { status = Number(headers[':status']); location = headers.location; cookies = headers['set-cookie'] ?? []; });
      stream.on('data', chunk => { body += chunk; if (body.length > 4 * 1024 * 1024) stream.destroy(new Error('Oversized development response')); });
      stream.on('end', () => resolve({ status, body, location, cookies }));
      stream.on('error', reject);
      stream.end(options.body);
    });
    const health = await request('/api/health');
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.body).ok, true);
    console.info('Passed: isolated source Home starts with verified TLS and HTTP/2 health');
    const signedIn = await request('/api/session', { method: 'POST' });
    assert.equal(signedIn.status, 200, 'The desktop session endpoint must accept the service credential');
    assert.equal(JSON.parse(signedIn.body).ok, true);
    const cookie = signedIn.cookies.find(value => value.startsWith(`${SESSION_COOKIE_NAME}=`));
    assert(cookie && cookie.startsWith(`${SESSION_COOKIE_NAME}=${encodeURIComponent(session.token)};`), 'Session cookie must contain the accepted credential');
    assert(/;\s*HttpOnly(?:;|$)/i.test(cookie) && /;\s*Secure(?:;|$)/i.test(cookie), 'The session cookie must be HttpOnly and Secure');
    console.info('Passed: real POST /api/session accepts the desktop credential and returns a secure session cookie');
    assert.equal((await request('/api/version')).status, 200);
    console.info('Passed: development proxy and authenticated API compile and respond');
    const initial = await request('/');
    assert.equal(initial.status, 307);
    assert.equal(initial.location, '/welcome');
    const page = await request('/welcome');
    assert.equal(page.status, 200);
    assert.match(page.body, /<html/);
    console.info('Passed: the actual Next development UI compiles and renders');
  } catch (error) {
    console.error(`Development service log: ${log}`);
    if (fs.existsSync(log)) console.error(redactServiceLine(fs.readFileSync(log, 'utf8').slice(-16_384), sessionToken ? [sessionToken] : [])
      .replace(/(#token=)[^\s&#]*/gi, '$1[redacted]'));
    throw error;
  } finally {
    client?.destroy();
    await stopService();
    assert.equal(await serviceStatus(), null, 'The fixture service must stop');
  }
  if (seeded) verifyRetiredDatabase(seeded);
  console.info(`Development acceptance passed (${retiredMode ?? 'fresh'}). Disposable evidence: ${temporary}`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

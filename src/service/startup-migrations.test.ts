/** Real compiled CLI -> separate controller -> SQLite startup. The HTTP child
 * is a local readiness fixture: no personal work, model or production Home.
 * Build with pnpm cli:build, then run through pnpm iso with
 * RI_SERVICE_BOOT_TEST=1 pnpm vitest run src/service/startup-migrations.test.ts.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { fixtureEnvironment } from '../../desktop/platform-qualification';
import { createDatabaseAt } from '@/test/fixtures/migrations';
import { hashToken } from '@/lib/auth/tokens';

const enabled = process.env.RI_SERVICE_BOOT_TEST === '1';
const exec = promisify(execFile);
const checkout = process.cwd();
const token = 'ri_test_service_migration_fixture';

it.skipIf(!enabled).each(['personal', 'team'] as const)('starts and restarts an existing %s Home with pending migrations without changing its identity or token', async kind => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-service-migrations-')));
  const repo = path.join(temporary, 'runtime');
  const env = fixtureEnvironment(process.env, { temporary });
  for (const dir of [env.HOME!, env.RI_ROOT!, env.RI_CONFIG_DIR!, env.RI_WORK_DIR!, path.join(repo, 'dist/service')]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(repo, 'package.json'), '{"version":"0.1.0"}');
  fs.cpSync(path.join(checkout, 'drizzle'), path.join(repo, 'drizzle'), { recursive: true });
  fs.symlinkSync(path.join(checkout, 'dist/service/main.cjs'), path.join(repo, 'dist/service/main.cjs'));
  fs.writeFileSync(path.join(repo, 'dist/service/http-server.cjs'), `
    const http = require('node:http');
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(req.url === '/__ri_ready' ? {ready:true,repo:process.cwd(),validation:false} : {status:'ok',app:'ri'}));
    });
    server.listen(Number(process.env.PORT), '127.0.0.1');
    process.once('SIGTERM', () => server.close(() => process.exit(0)));
    process.once('disconnect', () => process.exit(1));
  `);
  createDatabaseAt(env.RI_DB_PATH!, '0014_opposite_gorgon');
  const seed = new Database(env.RI_DB_PATH!);
  seed.exec(`
    INSERT INTO devices(id, name, kind, status) VALUES ('host-device', 'Fixture Mac', 'computer', 'active');
    INSERT INTO members(id, name, role, status) VALUES ('owner', 'Fixture owner', 'owner', 'active');
    INSERT INTO notes(rowid, id, title, body, status) VALUES (57, 'note', 'Keep this note', 'Original body', 'active');
  `);
  seed.prepare('INSERT INTO home(id, kind, name, host_device_id) VALUES (?, ?, ?, ?)').run('same-home-id', kind, 'Existing Home', 'host-device');
  seed.prepare('INSERT INTO api_keys(id, name, prefix, suffix, hash, env, role, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('host-key', 'Existing host key', 'ri_test_', 'ture', hashToken(token), 'test', 'sign_in', 'host-device');
  const before = seed.prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all();
  seed.close();
  fs.writeFileSync(path.join(env.RI_CONFIG_DIR!, 'config.json'), JSON.stringify({ version: 1, localToken: token }), { mode: 0o600 });
  if (kind === 'team') fs.writeFileSync(path.join(env.RI_CONFIG_DIR!, 'team.json'), JSON.stringify({ version: 1, kind: 'team', creationId: 'existing-fixture-team', name: 'Existing Home', createdAt: new Date().toISOString() }), { mode: 0o600 });
  const cli = async (action: string) => {
    try {
      const result = await exec(process.execPath, [path.join(checkout, 'dist/cli/index.mjs'), 'service', '--root', env.RI_ROOT!, action], { cwd: repo, env, timeout: 25_000, maxBuffer: 1024 * 1024 });
      return { code: 0, output: result.stdout + result.stderr };
    } catch (error) {
      const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
      return { code: failure.code ?? -1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
    }
  };
  try {
    const stopped = await cli('status');
    expect(stopped.code, stopped.output).toBe(0);
    const unchanged = new Database(env.RI_DB_PATH!, { readonly: true });
    expect(unchanged.prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all()).toEqual(before);
    unchanged.close();
    const started = await cli('start');
    expect(started.code, started.output).toBe(0);
    expect(started.output).toContain('Ri is running at https://localhost:');
    const inspect = () => {
      const db = new Database(env.RI_DB_PATH!, { readonly: true });
      try {
        expect(db.prepare('SELECT id, kind, host_device_id FROM home').get()).toEqual({ id: 'same-home-id', kind, host_device_id: 'host-device' });
        expect(db.prepare('SELECT rowid, title, body FROM notes WHERE id = ?').get('note')).toEqual({ rowid: 57, title: 'Keep this note', body: 'Original body' });
        expect(db.prepare('SELECT id, hash FROM api_keys').all()).toEqual([{ id: 'host-key', hash: hashToken(token) }]);
        const history = db.prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all();
        expect(history.slice(0, before.length)).toEqual(before);
        expect(history).toHaveLength(JSON.parse(fs.readFileSync(path.join(repo, 'drizzle/meta/_journal.json'), 'utf8')).entries.length);
        expect(db.prepare("SELECT name FROM pragma_table_info('team_ai_settings') WHERE name = 'auth_mode'").get()).toEqual({ name: 'auth_mode' });
        expect(db.pragma('foreign_key_check')).toEqual([]);
        return history;
      } finally { db.close(); }
    };
    const upgraded = inspect();
    expect(JSON.parse(fs.readFileSync(path.join(env.RI_CONFIG_DIR!, 'config.json'), 'utf8')).localToken).toBe(token);
    const attached = await cli('start');
    expect(attached.code, attached.output).toBe(0);
    expect(inspect()).toEqual(upgraded);
    const stoppedAgain = await cli('stop');
    expect(stoppedAgain.code, stoppedAgain.output).toBe(0);
    const restarted = await cli('start');
    expect(restarted.code, restarted.output).toBe(0);
    expect(inspect()).toEqual(upgraded);
  } finally {
    const stopped = await cli('stop');
    if (stopped.code !== 0) throw new Error(`Fixture cleanup failed. Retained ${temporary}: ${stopped.output}`);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}, 90_000);

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { createDatabaseAt } from '@/test/fixtures/migrations';

// Nothing may run: record what the first boot's scheduler pass would do.
const seen = vi.hoisted(() => ({ dispatch: [] as Array<{ sessionId: string; runId: string; ids: string[]; first: string }>, launch: [] as unknown[], fetch: [] as string[] }));
vi.mock('@/lib/executor/adapter', () => ({ isRunning: () => false, hasBackgroundTasks: () => false, abort: async () => {}, dispatch: async (sessionId: string, content: string, options: { runId: string; coordinationDeliveryIds?: string[]; onTaken?: () => void }) => { seen.dispatch.push({ sessionId, runId: options.runId, ids: options.coordinationDeliveryIds ?? [], first: content.split('\n')[0].slice(0, 120) }); options.onTaken?.(); } }));
vi.mock('@/lib/sessions/dispatch', () => ({ WorkspaceNotFoundForDispatch: class extends Error {}, DeviceUnavailableForDispatch: class extends Error {}, TaskNotStartableForDispatch: class extends Error {}, dispatchExecutionSession: async (input: unknown) => { seen.launch.push(input); throw new Error('launch suppressed in rehearsal'); } }));
vi.mock('@/lib/orchestrator/server-client', async original => ({ ...await original<object>(), serverFetch: async (route: string) => { seen.fetch.push(route); throw new Error('suppressed'); } }));
vi.mock('@/lib/executor/devices', async original => ({ ...await original<object>(), harnessCapabilitiesOn: async () => ({ sessions: true, concurrentSend: true }) }));

const PROD = process.env.RI_COORDINATION_REHEARSAL_DB;
const OUT = path.join(os.tmpdir(), 'ri-coordination-review-rehearsal.txt');
const log = (...parts: unknown[]) => fs.appendFileSync(OUT, parts.map(p => typeof p === 'string' ? p : JSON.stringify(p)).join(' ') + '\n');
let home: TestHome;
afterAll(async () => { await home?.cleanup(); });

it.runIf(!!PROD)('rehearses the forward migrations on prod coordination data and its dependencies', async () => {
  fs.writeFileSync(OUT, '');
  home = await createTestHome({ prefix: 'ri-coord-rehearsal-', openDb: false });
  createDatabaseAt(home.dbPath, '0018_home_default_variant');
  const prod = new Database(PROD!, { readonly: true, fileMustExist: true });
  const db = new Database(home.dbPath);
  const columns = (conn: Database.Database, table: string) => (conn.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name);
  const copy = (table: string, where = '', params: unknown[] = [], withRowid = false) => {
    const target = new Set(columns(db, table));
    const shared = columns(prod, table).filter(c => target.has(c));
    const cols = (withRowid ? ['rowid', ...shared] : shared);
    const rows = prod.prepare(`SELECT ${cols.map(c => c === 'rowid' ? 'rowid' : `"${c}"`).join(',')} FROM ${table} ${where}`).raw().all(...params) as unknown[][];
    const insert = db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.map(c => c === 'rowid' ? 'rowid' : `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
    db.transaction(() => { for (const row of rows) insert.run(...row); })();
    return rows.length;
  };
  db.pragma('foreign_keys = OFF');
  const counts: Record<string, number> = {};
  // One consistent read snapshot of prod.
  prod.exec('BEGIN');
  for (const table of ['workspaces', 'devices', 'triggers', 'executions', 'worker_commands']) counts[table] = copy(table);
  counts.chat_sessions = copy('chat_sessions', '', [], true);
  counts.runs = copy('runs', '', [], true);
  counts.agent_requests = copy('agent_requests');
  counts.agent_deliveries = copy('agent_deliveries');
  const eventIds = (prod.prepare(`SELECT message_event_id id FROM agent_requests UNION SELECT response_event_id FROM agent_requests WHERE response_event_id IS NOT NULL UNION SELECT event_id FROM agent_deliveries`).all() as Array<{ id: string }>).map(r => r.id);
  const cols = columns(prod, 'chat_events').filter(c => new Set(columns(db, 'chat_events')).has(c));
  const insertEvent = db.prepare(`INSERT INTO chat_events (rowid,${cols.map(c => `"${c}"`).join(',')}) VALUES (?,${cols.map(() => '?').join(',')})`);
  const readEvent = prod.prepare(`SELECT rowid,${cols.map(c => `"${c}"`).join(',')} FROM chat_events WHERE id = ?`).raw();
  let events = 0;
  db.transaction(() => { for (const id of eventIds) { const row = readEvent.get(id) as unknown[] | undefined; if (row) { insertEvent.run(...row); events++; } } })();
  counts.chat_events = events;
  prod.exec('COMMIT');
  prod.close();
  log('copied', counts);

  // Before snapshots.
  const oldRequests = db.prepare('SELECT * FROM agent_requests').all() as Array<Record<string, string | number | null>>;
  const oldDeliveries = db.prepare('SELECT * FROM agent_deliveries').all() as Array<Record<string, string | number | null>>;
  const eventRows = db.prepare('SELECT rowid, id, content FROM chat_events ORDER BY rowid').all();
  const chatRows = db.prepare('SELECT rowid, id FROM chat_sessions ORDER BY rowid').all();
  const runRows = db.prepare('SELECT rowid, id, status FROM runs ORDER BY rowid').all();
  const ftsBefore = db.prepare(`SELECT count(*) n FROM chat_events_fts`).get();
  db.close();

  // The real boot path: open through the app, which applies all pending forward migrations with the safe runner.
  (await import('@/lib/db/migrate')).allowMigrations(true);
  const { getDb, getRawDb } = await import('@/lib/db');
  getDb();
  const raw = getRawDb();
  const applied = raw.prepare('SELECT count(*) n FROM __drizzle_migrations').get() as { n: number };
  log('migrations applied in total', applied.n);

  expect(raw.prepare('SELECT rowid, id, content FROM chat_events ORDER BY rowid').all()).toEqual(eventRows);
  expect(raw.prepare('SELECT rowid, id FROM chat_sessions ORDER BY rowid').all()).toEqual(chatRows);
  expect(raw.prepare('SELECT rowid, id, status FROM runs ORDER BY rowid').all()).toEqual(runRows);
  log('fts rows before/after', ftsBefore, raw.prepare(`SELECT count(*) n FROM chat_events_fts`).get());
  log('quick_check', raw.pragma('quick_check'));
  expect(raw.pragma('integrity_check', {simple:true})).toBe('ok');
  const eligibleFtsRows = raw.prepare("SELECT rowid FROM chat_events WHERE source IN ('user','agent') AND content IS NOT NULL AND content <> '' ORDER BY rowid").pluck().all();
  expect(raw.prepare('SELECT rowid FROM chat_events_fts ORDER BY rowid').pluck().all()).toEqual(eligibleFtsRows);
  log('fk violations in coordination tables', raw.prepare(`SELECT * FROM pragma_foreign_key_check WHERE "table" LIKE 'agent_coordination_%'`).all());

  const requests = raw.prepare('SELECT * FROM agent_coordination_requests').all() as Array<Record<string, string | number | null>>;
  const deliveries = raw.prepare('SELECT * FROM agent_coordination_deliveries').all() as Array<Record<string, string | number | null>>;
  const byId = new Map(deliveries.map(d => [d.id, d]));
  const problems: string[] = [];
  for (const r of oldRequests) {
    const initial = byId.get(r.id);
    if (!initial) { problems.push(`missing initial delivery ${r.id}`); continue; }
    if (initial.event_id !== r.message_event_id) problems.push(`event id changed ${r.id}`);
    const payload = JSON.parse(String(initial.payload));
    if (payload.content !== r.content) problems.push(`content changed ${r.id}`);
    const event = raw.prepare('SELECT content FROM chat_events WHERE id = ?').get(r.message_event_id) as { content: string } | undefined;
    if (event && payload.prompt !== event.content) problems.push(`prompt differs from saved event ${r.id}`);
    if (r.kind !== 'message') {
      const nr = requests.find(x => x.id === r.id);
      if (!nr) problems.push(`missing request ${r.id}`);
      else if (nr.request_key !== r.request_key || nr.source_session_id !== r.source_session_id || nr.run_id !== r.run_id) problems.push(`request identity changed ${r.id}`);
    } else if (payload.requestKey !== r.request_key) problems.push(`fyi retry key lost ${r.id}`);
  }
  for (const d of oldDeliveries) {
    const nd = byId.get(d.id);
    if (!nd) { problems.push(`missing returned delivery ${d.id}`); continue; }
    if (nd.event_id !== d.event_id || nd.request_id !== d.request_id) problems.push(`returned identity changed ${d.id}`);
    const event = raw.prepare('SELECT content FROM chat_events WHERE id = ?').get(d.event_id) as { content: string } | undefined;
    if (event && JSON.parse(String(nd.payload)).prompt !== event.content) problems.push(`returned prompt differs ${d.id}`);
  }
  log('identity/byte problems', problems.length, problems.slice(0, 20));
  expect(raw.prepare(`SELECT * FROM pragma_foreign_key_check WHERE "table" LIKE 'agent_coordination_%'`).all()).toEqual([]);
  log('request status', raw.prepare('SELECT kind, status, count(*) n FROM agent_coordination_requests GROUP BY 1,2').all());
  log('delivery status', raw.prepare('SELECT kind, status, sender_kind, count(*) n FROM agent_coordination_deliveries GROUP BY 1,2,3').all());
  log('open requests', raw.prepare(`SELECT id, kind, status, run_id, (SELECT status FROM runs WHERE id = run_id) run_status, target_session_id FROM agent_coordination_requests WHERE status IN ('queued','working','waiting')`).all());
  log('schedulable deliveries', raw.prepare(`SELECT id, kind, status, target_session_id, request_id, created_at FROM agent_coordination_deliveries WHERE status IN ('queued','delivered','awaiting_approval')`).all());

  // First boot: recovery, then one scheduler pass. Nothing is executed.
  const service = await import('@/lib/coordination/service');
  service.recoverAgentCoordination();
  await service.drainAgentCoordination();
  await service.drainAgentCoordination();
  log('boot dispatches', seen.dispatch);
  log('boot launches', seen.launch.length, 'internal fetches', seen.fetch);
  log('after boot: request status', raw.prepare('SELECT kind, status, count(*) n FROM agent_coordination_requests GROUP BY 1,2').all());
  log('after boot: delivery status', raw.prepare('SELECT kind, status, count(*) n FROM agent_coordination_deliveries GROUP BY 1,2').all());
  expect(problems).toEqual([]);
  const previouslyAccepted = new Set(deliveries.filter(delivery => delivery.status === 'accepted').map(delivery => delivery.id));
  expect(seen.dispatch.flatMap(send => send.ids).some(id => previouslyAccepted.has(id))).toBe(false);
  expect(seen.launch).toHaveLength(0);
}, 300_000);

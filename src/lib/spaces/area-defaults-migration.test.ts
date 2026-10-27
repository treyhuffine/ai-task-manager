/** Real predecessor DDL and populated data, opened through the server's migration path. */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, openAsServer, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import { getDb, getRawDb, resetDb } from '@/lib/db';
import { allowMigrations, PendingMigrationsError } from '@/lib/db/migrate';
import { ensureHomeIdentity, resetHomeIdentityCache } from '@/lib/home/identity';
import { writeTeamIntent } from '@/lib/home/team-intent';
import { resetAuthorityCache } from '@/lib/home/authority';
import { saveTeamAiApiKey, hasTeamAiApiKey } from '@/lib/team/ai/secrets';
import { resumeTeamAiAfterStart } from '@/lib/team/ai/chat';

let home: TestHome;
const checkout = process.cwd();
beforeEach(async () => { home = await createTestHome({ prefix: 'ri-genuine-0019-', openDb: false }); resetHomeIdentityCache(); resetAuthorityCache(); vi.stubEnv('RI_MIRROR_DISABLED', '1'); });
afterEach(async () => { await home.cleanup(); resetHomeIdentityCache(); resetAuthorityCache(); vi.unstubAllEnvs(); });

it.each([['personal', 18], ['team', 18], ['personal', 19], ['team', 19], ['personal', 20], ['team', 20], ['personal', 21], ['team', 21], ['personal', 23], ['team', 23]] as const)('boots populated %s predecessor %s without changing data, rowids or sealed credentials', async (kind, predecessorIndex) => {
  const predecessor = path.join(home.root, 'predecessor'); fs.mkdirSync(path.join(predecessor, 'drizzle/meta'), { recursive: true });
  const canonical = JSON.parse(fs.readFileSync(path.join(checkout, 'drizzle/meta/_journal.json'), 'utf8'));
  const journal = structuredClone(canonical);
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= predecessorIndex);
  fs.writeFileSync(path.join(predecessor, 'drizzle/meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries) fs.copyFileSync(path.join(checkout, 'drizzle', entry.tag + '.sql'), path.join(predecessor, 'drizzle', entry.tag + '.sql'));
  vi.stubEnv('RI_RUNTIME_REPO', predecessor);
  if (kind === 'team') writeTeamIntent({ creationId: 'upgrade-fixture', name: 'Existing team' });
  ensureHomeIdentity();
  const raw = getRawDb();
  expect(raw.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({ n: journal.entries.length });
  if (predecessorIndex <= 23) expect(raw.prepare('PRAGMA table_info(chat_sessions)').all()).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'created_by_member_id' })]));
  const insert = (table: string, values: Record<string, string | number | null>) => {
    const columns = Object.keys(values); raw.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(values));
  };
  // In the predecessor's own columns: today's query code writes columns it doesn't have yet.
  const existingAiClient = (id: string, memberId: string | null) => insert('api_keys', {
    id, name: 'Existing client', prefix: 'ri_live', suffix: id.slice(-4), hash: `hash-${id}`, env: 'live', role: 'ai_client', member_id: memberId, device_id: null,
  });
  q.createTask({ title: 'Findable task', body: 'Findable task body' });
  q.createNote({ title: 'Findable note', body: 'Findable note body' });
  insert('chat_sessions', { id: 'kept-chat', type: 'orchestration', harness: 'claude', status: 'active', permission_mode: 'auto_all', surface_kind: kind === 'team' ? q.TEAM_CHAT_SURFACE : null });
  insert('chat_events', { id: 'event-z', session_id: 'kept-chat', role: 'user', source: 'user', content: 'Earlier question', created_at: '2026-10-18T10:00:00.000Z' });
  insert('chat_events', { id: 'event-a', session_id: 'kept-chat', role: 'assistant', source: 'agent', content: 'Earlier answer', created_at: '2026-10-18T10:00:01.000Z' });
  if (predecessorIndex >= 20) raw.prepare('UPDATE chat_sessions SET service_tier = ? WHERE id = ?').run('fast', 'kept-chat');
  if (kind === 'team') {
    // The owner, signed in on one device, as createTeamOwner leaves them.
    const owner = { member: { id: 'existing-owner' } };
    insert('members', { id: owner.member.id, name: 'Owner', role: 'owner', status: 'active', creation_id: 'upgrade-fixture' });
    insert('devices', { id: 'existing-owner-device', name: 'Browser', kind: 'computer', status: 'active' });
    insert('api_keys', { id: 'existing-owner-sign-in', name: 'Owner on Browser', prefix: 'ri_live', suffix: 'sign', hash: 'hash-existing-owner-sign-in', env: 'live', role: 'sign_in', member_id: owner.member.id, device_id: 'existing-owner-device' });
    existingAiClient('existing-team-client', owner.member.id);
    q.saveTeamAiSettings({ enabled: true, mainChatSessionId: 'kept-chat', model: 'existing-model' }, owner.member.id);
    await saveTeamAiApiKey('fixture-sealed-unused-key');
    for (const [seq, status] of [[1, 'done'], [2, 'running'], [3, 'queued']] as const) {
      const eventId = `request-${seq}`;
      insert('chat_events', { id: eventId, session_id: 'kept-chat', role: 'user', source: 'user', content: `Legacy ${status}`, author_member_id: owner.member.id });
      insert('team_chat_turns', { id: `legacy-${seq}`, chat_session_id: 'kept-chat', member_id: owner.member.id, message_event_id: eventId, client_send_id: `legacy-send-${seq}`, seq, status });
    }
  } else {
    existingAiClient('existing-personal-client', null);
    const connection = q.saveTeamConnection({ id: 'kept-source-team', name: 'Same name', url: 'https://fixture.example', memberId: 'kept-remote-member', memberName: 'Member', role: 'member' });
    const area = q.createArea({ name: 'Private organization' });
    const reference = q.createTask({ title: 'Retained shared task', body: 'Canonical cached text', areaId: area.id, userContext: 'Private plan', sortKey: 'a0' });
    raw.prepare('UPDATE tasks SET source_team_id = ?, source_task_id = ?, source_state = ?, source = ? WHERE id = ?').run(connection.id, 'canonical-task', 'active', JSON.stringify({ assigned: true, addedAt: null, bodyRevision: 0, statusChangedCount: 0, updatedAt: reference.updatedAt, syncedAt: reference.updatedAt, area: { id: 'remote-area', name: 'Source Area' }, assignee: null }), reference.id);
    const note = q.createNote({ title: 'Saved team note', body: 'Canonical note text', areaId: area.id });
    raw.prepare('UPDATE notes SET source_team_id = ?, source_note_id = ?, source_state = ?, source = ? WHERE id = ?').run(connection.id, 'canonical-note', 'active', JSON.stringify({ addedAt: note.createdAt, bodyRevision: 0, updatedAt: note.updatedAt, syncedAt: note.updatedAt, area: null }), note.id);
    insert('entity_links', { id: 'retained-link', source_type: 'task', source_id: reference.id, target_type: 'note', target_id: note.id });
  }
  const tables = ['areas', 'team_connections', 'entity_links', 'home', 'devices', 'members', 'api_keys', 'tasks', 'notes', 'chat_sessions', 'chat_events', 'team_chat_turns', 'team_ai_settings'];
  const columns = new Map(tables.map(table => [table, (raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(column => column.name).join(',')]));
  const snapshot = () => Object.fromEntries(tables.map(table => [table, getRawDb().prepare(`SELECT rowid, ${columns.get(table)} FROM ${table} ORDER BY rowid`).all()]));
  const before = snapshot();
  const originalJournal = raw.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all();
  const credentialPath = path.join(home.configDir, 'team-ai/credentials.json');
  const sealed = fs.existsSync(credentialPath) ? fs.readFileSync(credentialPath, 'utf8') : null;
  resetDb(); vi.stubEnv('RI_RUNTIME_REPO', checkout); allowMigrations(false);
  expect(() => getDb()).toThrow(PendingMigrationsError);
  await openAsServer();
  expect(snapshot()).toEqual(before);
  expect(getRawDb().prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({ n: canonical.entries.length });
  expect(getRawDb().prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all()).toEqual(expect.arrayContaining(originalJournal));
  if (predecessorIndex >= 20) expect(q.getChatSession('kept-chat')?.serviceTier).toBe('fast');
  expect(getRawDb().pragma('foreign_key_check')).toEqual([]);
  getRawDb().exec("INSERT INTO tasks_fts(tasks_fts) VALUES('integrity-check'); INSERT INTO notes_fts(notes_fts) VALUES('integrity-check');");
  expect(getRawDb().prepare("SELECT count(*) AS n FROM tasks_fts WHERE tasks_fts MATCH 'Findable'").get()).toEqual({ n: 1 });
  expect(q.getChatSession('kept-chat')?.createdByMemberId).toBeNull();
  expect(q.listChatEvents('kept-chat').filter(event => event.id.startsWith('event-')).map(event => event.id)).toEqual(['event-z', 'event-a']);
  if (kind === 'team') {
    expect(fs.readFileSync(credentialPath, 'utf8')).toBe(sealed); expect(hasTeamAiApiKey()).toBe(true);
    resumeTeamAiAfterStart();
    expect(q.getTeamChatTurn('legacy-1')?.status).toBe('done'); expect(q.getTeamChatTurn('legacy-2')?.status).toBe('interrupted'); expect(q.getTeamChatTurn('legacy-3')?.status).toBe('cancelled');
    expect(q.listChatEvents('kept-chat').filter(event => event.source === 'error')).toHaveLength(2);
  }
  const journalAfter = getRawDb().prepare('SELECT * FROM __drizzle_migrations').all();
  await openAsServer(); expect(getRawDb().prepare('SELECT * FROM __drizzle_migrations').all()).toEqual(journalAfter);
});

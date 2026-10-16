import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import type { Ctx } from '../src/domain/context.js';
import { refreshPerson } from '../src/domain/people.js';
import { refreshOrganization } from '../src/domain/organizations.js';
import { sortKey } from '../src/domain/text.js';
import { setSearchRow } from '../src/domain/search.js';
import { call, chat, owner, setup, teardown } from './helpers.js';

/**
 * Release target: 10,000 people, 1,000 companies and 100,000 interactions.
 * The synthetic volume is written straight into a temporary database with
 * the same derived rows the app maintains, then repeated list, search and
 * detail calls are timed. p95 must stay under 300 ms, excluding startup,
 * provider calls and AI. Results are written to artifacts/performance.json.
 */
const PEOPLE = 10_000, COMPANIES = 1_000, INTERACTIONS = 100_000;
const FIRST = ['Maya', 'Jordan', 'Priya', 'Alex', 'Sam', 'Elena', 'Noah', 'Ava', 'Liam', 'Mia', 'Ethan', 'Zoe', 'Lucas', 'Isla', 'Mateo', 'Nora', 'Kai', 'Lena', 'Omar', 'Ines', 'Hugo', 'Amara', 'Leo', 'Yara', 'Felix', 'Sofia', 'Arjun', 'Hana', 'Theo', 'Mila', 'Ravi', 'Chloe', 'Ezra', 'Freya', 'Jonas', 'Lucia', 'Milo', 'Rosa', 'Tariq', 'Uma', 'Victor', 'Wren', 'Xavier', 'Yusuf', 'Zara', 'Bruno', 'Clara', 'Dario', 'Esme', 'Farah'];
const LAST = ['Chen', 'Bell', 'Shah', 'Rivera', 'Okafor', 'Park', 'Moreno', 'Ito', 'Nguyen', 'Silva', 'Haddad', 'Kowalski', 'Mensah', 'Novak', 'Rossi', 'Sato', 'Tanaka', 'Weber', 'Young', 'Zhang', 'Abara', 'Brandt', 'Costa', 'Dubois', 'Eklund', 'Fischer', 'Garcia', 'Huang', 'Ivanova', 'Jensen', 'Khan', 'Lopez', 'Murphy', 'Nakamura', 'Olsen', 'Petrov', 'Quinn', 'Reyes', 'Schmidt', 'Torres', 'Usman', 'Vargas', 'Walsh', 'Xu', 'Yilmaz', 'Zimmer', 'Adler', 'Baptiste', 'Cruz', 'Dahl', 'Evans', 'Ferreira', 'Gomez', 'Hart', 'Ibrahim', 'Jovanovic', 'Kim', 'Lund', 'Meyer', 'Nilsen', 'Ortiz', 'Patel', 'Quispe', 'Rahman', 'Santos', 'Thomsen', 'Ueda', 'Vidal', 'Wong', 'Yamada', 'Zeller', 'Arnaud', 'Bianchi', 'Castro', 'Dimitrov', 'Engel', 'Fontaine', 'Gupta', 'Horvat', 'Iyer', 'Jansen', 'Keller', 'Larsen', 'Moreau', 'Nowak', 'Oliveira', 'Pereira', 'Ramos', 'Svensson', 'Takahashi', 'Ulrich', 'Varga', 'Wagner', 'Yoon', 'Ziegler', 'Alvarez', 'Bauer', 'Carvalho', 'Duarte', 'Ellis', 'Fujita'];
const WORDS = ['North', 'Field', 'Atlas', 'Harbor', 'Cedar', 'Summit', 'Lumen', 'Quarry', 'Beacon', 'Orbit', 'Meadow', 'Signal', 'Copper', 'Willow', 'Granite', 'Delta', 'Prairie', 'Vector', 'Ember', 'Tidal'];
const SUFFIX = ['works', 'studio', 'labs', 'partners', 'collective', 'systems', 'group', 'trust', 'foundry', 'house'];

let ctx: Ctx | null = null;
const results: Record<string, { p50: number; p95: number; max: number; runs: number }> = {};
let seedMs = 0;

function seed(c: Ctx) {
  const started = performance.now();
  const time = c.now().toISOString();
  const db = c.db;
  let rng = 42;
  const random = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648; };
  const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)];
  const orgIds: string[] = [];
  const personIds: string[] = [], keyIds: string[] = [], sourceOf: string[] = [];
  db.tx(() => {
    for (const [account, label] of [['perf-a', 'Personal Gmail'], ['perf-b', 'Work Gmail']]) c.accounts.setup({ account, kind: 'mail', historyDays: 365, label });
    for (let index = 0; index < COMPANIES; index++) {
      const id = randomUUID(), name = `${WORDS[index % 20]} ${SUFFIX[Math.floor(index / 20) % 10]} ${Math.floor(index / 200) + 1}`;
      db.run("INSERT INTO organizations (id, created_at, updated_at, revision, collection, origin, name_override, display_name, sort_name, name_source, kind, website, state, archived_at, last_activity_at, merged_into, merged_at) VALUES (?, ?, ?, 1, 'manual', 'manual', ?, ?, ?, 'manual', 'company', ?, 'confirmed', NULL, NULL, NULL, NULL)",
        id, time, time, name, name, sortKey(name), `company${index}.example`);
      db.run("INSERT INTO organization_domains (id, created_at, updated_at, organization_id, domain, source_key, confirmation, evidence_id) VALUES (?, ?, ?, ?, ?, 'manual', 'confirmed', NULL)", randomUUID(), time, time, id, `company${index}.example`);
      orgIds.push(id);
    }
    for (let index = 0; index < PEOPLE; index++) {
      const id = randomUUID(), key = randomUUID();
      const first = FIRST[index % FIRST.length], last = LAST[Math.floor(index / FIRST.length) % LAST.length];
      const name = `${first} ${last}${index >= FIRST.length * LAST.length ? ` ${Math.floor(index / (FIRST.length * LAST.length))}` : ''}`;
      const personal = index % 5 === 0;
      const email = `${first.toLowerCase()}.${last.toLowerCase()}${index}@${personal ? 'fastmail.com' : `company${index % COMPANIES}.example`}`;
      const source = index % 2 ? 'account:perf-b' : 'account:perf-a';
      db.run("INSERT INTO persons (id, created_at, updated_at, revision, collection, origin, name_override, display_name, sort_name, name_source, headline, pinned, archived_at, keep_in_touch_days, last_exchange_at, merged_into, merged_at) VALUES (?, ?, ?, 1, 'manual', 'sent_mail', NULL, ?, ?, NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL)",
        id, time, time, name, sortKey(name), index % 50 === 0 ? 1 : 0);
      db.run("INSERT INTO identity_keys (id, created_at, updated_at, revision, kind, normalized, owner_kind, owner_id, shared, decision) VALUES (?, ?, ?, 1, 'email', ?, 'person', ?, 0, 'auto')", key, time, time, email, id);
      db.run("INSERT INTO identity_observations (id, created_at, updated_at, key_id, source_key, value, observed_name, observed_at, last_seen_at, evidence_id, confirmation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'observed')", randomUUID(), time, time, key, source, email, name, time, time);
      if (!personal && index % 10 < 7)
        db.run("INSERT INTO affiliations (id, created_at, updated_at, revision, person_id, organization_id, role, valid_from, valid_to, observed_at, status, confidence, source_key, origin, evidence_id, decision, decision_key) VALUES (?, ?, ?, 1, ?, ?, ?, NULL, NULL, ?, 'current', 'confirmed', 'manual', 'manual', NULL, NULL, ?)",
          randomUUID(), time, time, id, orgIds[index % COMPANIES], pick(['Founder', 'Design lead', 'Operations', 'Engineer', 'Partner', 'Researcher']), time, randomUUID());
      personIds.push(id); keyIds.push(key); sourceOf.push(source);
    }
    const now = Date.now();
    for (let index = 0; index < INTERACTIONS; index++) {
      const id = randomUUID(), evidence = randomUUID();
      const meeting = index % 10 === 0;
      const at = new Date(now - Math.floor(random() * 365 * 864e5) + (meeting && index % 30 === 0 ? 20 * 864e5 : 0)).toISOString();
      const lead = Math.floor(random() * PEOPLE);
      const source = sourceOf[lead];
      const sent = random() < 0.5;
      db.run("INSERT INTO interactions (id, created_at, updated_at, revision, source_key, provider, external_id, kind, occurred_at, ends_at, subject, direction, thread_key, message_id_header, status, excluded_reason, included, participant_count, evidence_id, digest, attendance, owner_response, time_zone, recurring_key, link) VALUES (?, ?, ?, 1, ?, 'gmail', ?, ?, ?, NULL, ?, ?, ?, NULL, 'active', NULL, 0, 2, ?, NULL, 'unknown', NULL, NULL, NULL, NULL)",
        id, time, time, source, `x${index}`, meeting ? 'meeting' : 'email', at, `${pick(['Project', 'Proposal', 'Catch-up', 'Intro', 'Planning', 'Review'])} ${index}`, meeting ? 'meeting' : sent ? 'sent' : 'received', `t${Math.floor(index / 3)}`, evidence);
      db.run("INSERT INTO evidence (id, created_at, updated_at, source_key, interaction_id, kind, blob_digest, excerpt, source_date, title, participants, link, source_revision, status) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, '[]', NULL, NULL, 'available')",
        evidence, time, time, source, id, meeting ? 'event' : 'email', 'A short fictional excerpt of the conversation for the timeline.', at, `Subject ${index}`);
      const participants = new Set([lead, Math.floor(random() * PEOPLE)]);
      for (const person of participants)
        db.run("INSERT INTO interaction_participants (id, created_at, updated_at, interaction_id, key_id, person_id, role, source_key, occurred_at, kind, direct, active) VALUES (?, ?, ?, ?, ?, ?, 'to', ?, ?, ?, ?, 1) ON CONFLICT(interaction_id, key_id) DO NOTHING",
          `${id}:${keyIds[person]}`, time, time, id, keyIds[person], personIds[person], source, at, meeting ? 'meeting' : 'email', meeting ? 0 : 1);
    }
    for (let index = 0; index < 20; index++) {
      const list = randomUUID();
      db.run("INSERT INTO lists (id, created_at, updated_at, revision, name, record_kind, collection, archived_at) VALUES (?, ?, ?, 1, ?, 'person', 'manual', NULL)", list, time, time, `List ${index}`);
      for (let member = 0; member < 100; member++) db.run("INSERT INTO list_members (id, created_at, updated_at, list_id, member_id, position, added_by) VALUES (?, ?, ?, ?, ?, ?, 'owner') ON CONFLICT(list_id, member_id) DO NOTHING", `${list}:${member}`, time, time, list, personIds[(index * 397 + member * 13) % PEOPLE], member);
    }
    for (let index = 0; index < 3000; index++) {
      const subject = personIds[(index * 7) % PEOPLE], note = randomUUID();
      db.run("INSERT INTO notes (id, created_at, updated_at, revision, subject_kind, subject_id, title, body, collection, archived_at) VALUES (?, ?, ?, 1, 'person', ?, NULL, ?, 'manual', NULL)", note, time, time, subject, `Fictional note ${index} about project planning.`);
      setSearchRow(c, `note:${note}`, 'person', subject, 'manual', `Fictional note ${index} about project planning.`);
    }
    for (let index = 0; index < 2000; index++)
      db.run("INSERT INTO commitments (id, created_at, updated_at, revision, person_id, organization_id, opportunity_id, direction, actor_label, recipient_label, action, due_date, extracted_action, extracted_due_date, evidence_id, interaction_id, source_key, passage, state, origin, snoozed_until, decision_key, extraction_version, completion_evidence_id, resolution, task_link_id, previous_decision, anchor) VALUES (?, ?, ?, 1, ?, NULL, NULL, ?, 'You', 'Them', ?, ?, NULL, NULL, NULL, NULL, 'manual', NULL, ?, 'manual', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)",
        randomUUID(), time, time, personIds[(index * 11) % PEOPLE], index % 3 ? 'i_owe' : 'waiting_on', `Follow up on item ${index}`, new Date(now + (index % 60 - 20) * 864e5).toISOString().slice(0, 10), index % 4 ? 'accepted' : 'suggested');
    for (const id of personIds) refreshPerson(c, id);
    for (const id of orgIds) refreshOrganization(c, id);
  });
  return { personIds, orgIds, elapsed: performance.now() - started };
}

let ids: { personIds: string[]; orgIds: string[] };
beforeAll(async () => {
  ctx = await setup({ now: new Date().toISOString(), realTime: true });
  const seeded = seed(ctx);
  ids = { personIds: ctx.db.all<{ id: string }>('SELECT id FROM persons ORDER BY sort_name LIMIT 10000').map((row) => row.id), orgIds: seeded.orgIds };
  seedMs = seeded.elapsed;
}, 600_000);
afterAll(() => {
  const dir = path.resolve(import.meta.dirname, '..', 'artifacts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'performance.json'), JSON.stringify({ measuredAt: new Date().toISOString(), volume: { people: PEOPLE, companies: COMPANIES, interactions: INTERACTIONS }, seedSeconds: Math.round(seedMs / 100) / 10, node: process.version, platform: `${process.platform} ${process.arch}`, results }, null, 2));
  teardown(ctx);
  ctx = null;
});

async function measure(label: string, runs: number, work: (index: number) => Promise<unknown>) {
  await work(0);
  const times: number[] = [];
  for (let index = 1; index <= runs; index++) {
    const started = performance.now();
    await work(index);
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  const at = (q: number) => Math.round(times[Math.min(times.length - 1, Math.ceil(q * times.length) - 1)] * 10) / 10;
  results[label] = { p50: at(0.5), p95: at(0.95), max: Math.round(times.at(-1)! * 10) / 10, runs };
  return results[label];
}

describe('Large synthetic records meet the stated bounded-query and measured latency target. Record open starts no import, full-table scan or AI call.', () => {
  const me = owner(['perf-a', 'perf-b']);
  it('seeded 10,000 people, 1,000 companies and 100,000 interactions', () => {
    expect(ctx!.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM persons')!.count).toBe(PEOPLE);
    expect(ctx!.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM organizations')!.count).toBe(COMPANIES);
    expect(ctx!.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM interactions')!.count).toBe(INTERACTIONS);
  });

  it('owner list, search and detail calls stay under 300 ms at p95', async () => {
    const sorts = ['name', 'last_exchange', 'next_action', 'added', 'next_meeting'] as const;
    expect((await measure('list_people first page by name', 30, () => call('list_people', { limit: 50 }, me))).p95).toBeLessThan(300);
    expect((await measure('list_people with each sort', 40, (index) => call('list_people', { limit: 50, sort: { key: sorts[index % 5], direction: index % 2 ? 'asc' : 'desc' } }, me))).p95).toBeLessThan(300);
    let cursor: string | null = null;
    expect((await measure('list_people paging 100 per page', 30, async () => { const page: { nextCursor: string | null } = await call('list_people', { limit: 100, ...(cursor ? { cursor } : {}) }, me); cursor = page.nextCursor; })).p95).toBeLessThan(300);
    expect((await measure('list_people filtered by company, list and last exchange', 30, (index) => call('list_people', { limit: 50, filters: { organizationIds: [ids.orgIds[index % 50]], lastExchange: { olderThanDays: 30, includeNone: true } } }, me))).p95).toBeLessThan(300);
    expect((await measure('list_people with next meeting filter', 20, () => call('list_people', { limit: 50, filters: { nextMeeting: { withinDays: 30 } } }, me))).p95).toBeLessThan(300);
    expect((await measure('list_people with follow-up filter', 20, () => call('list_people', { limit: 50, filters: { hasFollowUp: true } }, me))).p95).toBeLessThan(300);
    const terms = ['maya', 'chen', 'priya shah', 'north', 'company12', 'planning', 'rivera', 'zz'];
    expect((await measure('search_people', 40, (index) => call('search_people', { text: terms[index % terms.length], limit: 20 }, me))).p95).toBeLessThan(300);
    expect((await measure('get_person', 40, (index) => call('get_person', { id: ids.personIds[(index * 97) % ids.personIds.length] }, me))).p95).toBeLessThan(300);
    expect((await measure('list_interactions person timeline', 40, (index) => call('list_interactions', { subjectKind: 'person', subjectId: ids.personIds[(index * 131) % ids.personIds.length], limit: 50 }, me))).p95).toBeLessThan(300);
    expect((await measure('list_organizations', 30, (index) => call('list_organizations', { limit: 50, sort: { key: (['name', 'added', 'next_action', 'last_exchange'] as const)[index % 4], direction: 'asc' } }, me))).p95).toBeLessThan(300);
    expect((await measure('get_organization', 30, (index) => call('get_organization', { id: ids.orgIds[(index * 37) % ids.orgIds.length] }, me))).p95).toBeLessThan(300);
    expect((await measure('get_today', 20, () => call('get_today', {}, me))).p95).toBeLessThan(300);
  }, 300_000);

  it('a narrower chat\'s scoped list, search and detail calls stay under 300 ms at p95', async () => {
    const scope = await call('create_scope', { actorId: 'chat:perf', sources: ['account:perf-b', 'manual'], operations: ['read'] }, me);
    const narrow = chat('perf', scope.scopeRef);
    expect((await measure('chat list_people by name', 30, () => call('list_people', { limit: 50 }, narrow))).p95).toBeLessThan(300);
    expect((await measure('chat list_people by last exchange', 30, () => call('list_people', { limit: 50, sort: { key: 'last_exchange', direction: 'desc' } }, narrow))).p95).toBeLessThan(300);
    expect((await measure('chat search_people', 30, (index) => call('search_people', { text: ['maya', 'bell', 'north'][index % 3], limit: 20 }, narrow))).p95).toBeLessThan(300);
    const visible = (await call('list_people', { limit: 50 }, narrow)).items.map((item: { id: string }) => item.id);
    expect((await measure('chat get_person', 30, (index) => call('get_person', { id: visible[index % visible.length] }, narrow))).p95).toBeLessThan(300);
  }, 300_000);

  it('opening a record calls no capability and uses indexed lookups on the large tables', async () => {
    let capabilityCalls = 0;
    const counted = owner(['perf-a', 'perf-b'], async () => { capabilityCalls++; return {}; });
    ctx!.db.trace = [];
    await call('get_person', { id: ids.personIds[1234] }, counted);
    await call('list_interactions', { subjectKind: 'person', subjectId: ids.personIds[1234], limit: 50 }, counted);
    await call('get_briefing', { subjectKind: 'person', subjectId: ids.personIds[1234] }, counted);
    const traced = ctx!.db.trace;
    ctx!.db.trace = null;
    expect(capabilityCalls).toBe(0);
    const big = /\bSCAN (persons|interactions|interaction_participants|identity_observations|identity_keys|evidence|affiliations|person_sources|notes|commitments|search_rows)\b(?! USING)/;
    const scans = new Set<string>();
    for (const statement of traced) {
      const plan = ctx!.db.raw.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`).all(...statement.params as never[]) as { detail: string }[];
      for (const step of plan) if (big.test(step.detail)) scans.add(`${step.detail} :: ${statement.sql.replace(/\s+/g, ' ').slice(0, 160)}`);
    }
    expect([...scans]).toEqual([]);
  }, 120_000);
});

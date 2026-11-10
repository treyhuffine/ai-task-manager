import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Ctx } from '../src/domain/context.js';
import { parseBirthday, parseVcards, rowsFromTable, parseCsv } from '../src/domain/imports/parse.js';
import { daysUntil } from '../src/domain/personal.js';
import { call, chat, expectCode, job, owner, setup, teardown } from './helpers.js';
import { fakeHost, mail, OWNER } from './fakes.js';

let ctx: Ctx | null = null;
beforeEach(async () => { ctx = await setup({ now: new Date().toISOString(), realTime: true }); });
afterEach(() => { teardown(ctx); ctx = null; });
const recent = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
const inDays = (days: number) => { const date = new Date(Date.now() + days * 864e5); return { month: date.getMonth() + 1, day: date.getDate() }; };

/** Maya arrives from a mailbox (account source). Her personal details are written by the owner into the main collection. */
async function world() {
  const host = fakeHost({ personal: { email: OWNER, mail: [
    mail('p1', { from: OWNER, to: ['Maya Chen <maya@northstar.example>'], subject: 'Portfolio review', body: 'Let us talk.', sent: true, date: recent(3) }),
  ] } });
  const scheduled = job([{ account: 'personal' }], host.capability);
  for (let index = 0; index < 10; index++) if (!(await call('run_background_step', {}, scheduled)).ran) break;
  const me = owner(['personal'], host.capability);
  const maya = (await call('list_people', { limit: 10 }, me)).items[0] as { id: string; revision: number };
  const jordan = (await call('save_person', { name: 'Jordan Bell' }, me)).record as { id: string };
  const accountOnly = chat('a', (await call('create_scope', { actorId: 'chat:a', sources: ['account:personal'], operations: ['read'] }, me)).scopeRef);
  const withRecords = chat('b', (await call('create_scope', { actorId: 'chat:b', sources: ['account:personal', 'manual'], operations: ['read', 'write'] }, me)).scopeRef);
  return { me, maya, jordan, accountOnly, withRecords };
}
const revisionOf = async (id: string, caller = owner()) => (await call('get_person', { id }, caller)).person.revision as number;

describe('personal details', () => {
  it('saves a birthday, location, how you met and My read, and rejects dates that do not exist', async () => {
    const w = await world();
    await call('save_person', { id: w.maya.id, expectedRevision: await revisionOf(w.maya.id, w.me), birthday: { month: 3, day: 14, year: null }, location: '  Lisbon ', howMet: 'Introduced by Jordan', myRead: 'Direct.\nWants examples.' }, w.me);
    const person = (await call('get_person', { id: w.maya.id }, w.me)).person;
    expect(person).toMatchObject({ birthday: { month: 3, day: 14, year: null }, location: 'Lisbon', howMet: 'Introduced by Jordan', myRead: 'Direct.\nWants examples.' });
    await expectCode(call('save_person', { id: w.maya.id, expectedRevision: person.revision, birthday: { month: 2, day: 30, year: null } }, w.me), 'invalid_input');
    await expectCode(call('save_person', { id: w.maya.id, expectedRevision: person.revision, birthday: { month: 2, day: 29, year: 2023 } }, w.me), 'invalid_input');
    expect((await call('save_person', { id: w.maya.id, expectedRevision: person.revision, birthday: { month: 2, day: 29, year: 2024 } }, w.me)).status).toBe('saved');
    // Clearing a field is explicit.
    await call('save_person', { id: w.maya.id, expectedRevision: await revisionOf(w.maya.id, w.me), location: null }, w.me);
    expect((await call('get_person', { id: w.maya.id }, w.me)).person.location).toBeNull();
  });

  it('shows personal details only to readers of the person\'s collection, in detail, search, export and context', async () => {
    const w = await world();
    await call('save_person', { id: w.maya.id, expectedRevision: await revisionOf(w.maya.id, w.me), birthday: { month: 3, day: 14, year: 1990 }, location: 'Lisbon', myRead: 'Private read' }, w.me);
    const narrow = (await call('get_person', { id: w.maya.id }, w.accountOnly)).person;
    expect(narrow).toMatchObject({ birthday: null, location: null, howMet: null, myRead: null });
    expect((await call('get_person', { id: w.maya.id }, w.withRecords)).person.location).toBe('Lisbon');
    // Search under a source holds only what that source may see.
    expect((await call('search_people', { text: 'lisbon', limit: 10 }, w.me)).total).toBe(1);
    expect((await call('search_people', { text: 'lisbon', limit: 10 }, w.accountOnly)).total).toBe(0);
    const context = await call('get_relationship_context', { subjectKind: 'person', subjectId: w.maya.id }, w.accountOnly);
    expect(JSON.stringify(context)).not.toMatch(/Lisbon|Private read|March/);
    const ownerContext = await call('get_relationship_context', { subjectKind: 'person', subjectId: w.maya.id }, w.me);
    expect(ownerContext.items.filter((item: { kind: string }) => item.kind === 'personal').map((item: { text: string }) => item.text)).toEqual(expect.arrayContaining(['Birthday: March 14, 1990.', 'Lives in Lisbon.']));
    const ownerCsv = (await call('export_records', { table: 'people' }, w.me)).content as string;
    expect(ownerCsv.split('\n')[0]).toContain('birthday,location,how_met,my_read');
    expect(ownerCsv).toContain('1990-03-14');
  });

  it('lists birthdays in the next two weeks on Today, nearest first, with an age when the year is known', async () => {
    const w = await world();
    const soon = inDays(3), today = inDays(0), later = inDays(40);
    await call('save_person', { id: w.maya.id, expectedRevision: await revisionOf(w.maya.id, w.me), birthday: { ...soon, year: 1990 } }, w.me);
    await call('save_person', { id: w.jordan.id, expectedRevision: await revisionOf(w.jordan.id, w.me), birthday: { ...today, year: null } }, w.me);
    const elena = (await call('save_person', { name: 'Elena Park' }, w.me)).record;
    await call('save_person', { id: elena.id, expectedRevision: elena.revision, birthday: { ...later, year: null } }, w.me);
    const birthdays = (await call('get_today', {}, w.me)).birthdays;
    expect(birthdays.map((item: { name: string; inDays: number }) => [item.name, item.inDays])).toEqual([['Jordan Bell', 0], ['Maya Chen', 3]]);
    const thisYear = new Date(Date.now() + 3 * 864e5).getFullYear();
    expect(birthdays[1].turns).toBe(thisYear - 1990);
    expect(birthdays[0].turns).toBeNull();
    // A chat that can't see the main collection sees no birthdays.
    expect((await call('get_today', {}, w.accountOnly)).birthdays).toEqual([]);
  });

  it('counts days to a birthday across the year end and puts February 29 on March 1 in other years', () => {
    expect(daysUntil('2026-12-30', 1, 2)).toBe(3);
    expect(daysUntil('2026-03-14', 3, 14)).toBe(0);
    expect(daysUntil('2027-02-27', 2, 29)).toBe(2);
    expect(daysUntil('2028-02-27', 2, 29)).toBe(2);
  });
});

describe('relationships', () => {
  it('reads from both sides, links a record or names someone, and archives on remove', async () => {
    const w = await world();
    const intro = await call('save_relation', { personId: w.maya.id, kind: 'introduced_by', relatedPersonId: w.jordan.id }, w.me);
    expect(intro.record).toMatchObject({ label: 'Introduced by', person: { id: w.jordan.id, name: 'Jordan Bell' }, direction: 'outgoing' });
    await call('save_relation', { personId: w.jordan.id, kind: 'child', relatedName: 'Leo', note: 'Turns 7 in May' }, w.me);
    const jordan = await call('get_person', { id: w.jordan.id }, w.me);
    expect(jordan.relations.map((item: { label: string; name: string }) => `${item.label} ${item.name}`)).toEqual(['Introduced Maya Chen', 'Child Leo']);
    await expectCode(call('save_relation', { personId: w.jordan.id, kind: 'friend', relatedPersonId: w.jordan.id }, w.me), 'invalid_input');
    await expectCode(call('save_relation', { personId: w.jordan.id, kind: 'friend' }, w.me), 'invalid_input');
    await call('save_relation', { id: intro.record.id, expectedRevision: intro.record.revision, archived: true }, w.me);
    expect((await call('get_person', { id: w.maya.id }, w.me)).relations).toEqual([]);
    expect((await call('save_relation', { id: intro.record.id, expectedRevision: intro.record.revision, note: 'stale' }, w.me)).status).toBe('conflict');
  });

  it('never shows a relationship to someone the reader can\'t see', async () => {
    const w = await world();
    await call('save_relation', { personId: w.maya.id, kind: 'introduced_by', relatedPersonId: w.jordan.id }, w.me);
    // The relationship lives in the main collection. A chat without it sees nothing, a chat with it sees both people.
    expect((await call('get_person', { id: w.maya.id }, w.accountOnly)).relations).toEqual([]);
    expect((await call('get_person', { id: w.maya.id }, w.withRecords)).relations).toHaveLength(1);
    const csv = (await call('export_records', { table: 'relations' }, w.me)).content as string;
    expect(csv.trim().split('\n')).toHaveLength(2);
    expect(csv).toContain('introduced_by');
  });
});

describe('merges keep the personal side', () => {
  it('fills the survivor\'s empty details from the merged person in the same collection, moves relationships, and undo restores both', async () => {
    const w = await world();
    const a = (await call('save_person', { name: 'Sam Okafor' }, w.me)).record;
    const b = (await call('save_person', { name: 'Sam O.', birthday: { month: 6, day: 1, year: null }, location: 'Accra' }, w.me)).record;
    await call('save_relation', { personId: b.id, kind: 'friend', relatedPersonId: w.jordan.id }, w.me);
    await call('save_relation', { personId: a.id, kind: 'colleague', relatedPersonId: b.id }, w.me);
    const merged = await call('merge_people', { survivorId: a.id, mergedId: b.id, survivorRevision: await revisionOf(a.id, w.me), mergedRevision: await revisionOf(b.id, w.me) }, w.me);
    expect(merged.status).toBe('saved');
    const survivor = await call('get_person', { id: a.id }, w.me);
    expect(survivor.person).toMatchObject({ birthday: { month: 6, day: 1, year: null }, location: 'Accra' });
    // The relationship between the two merged people would point at itself, so it goes. The other one follows.
    expect(survivor.relations.map((item: { label: string; name: string }) => `${item.label} ${item.name}`)).toEqual(['Friend Jordan Bell']);
    const preview = await call('undo_merge', { mergeId: merged.mergeId, preview: true }, w.me);
    await call('undo_merge', { mergeId: merged.mergeId, expectedRevision: preview.revision, digest: preview.digest, attributions: [] }, w.me);
    const restored = await call('get_person', { id: a.id }, w.me);
    expect(restored.person).toMatchObject({ birthday: null, location: null });
    expect(restored.relations.map((item: { label: string; name: string }) => `${item.label} ${item.name}`)).toEqual(['Colleague Sam O.']);
    expect((await call('get_person', { id: b.id }, w.me)).relations.map((item: { label: string; name: string }) => `${item.label} ${item.name}`).sort()).toEqual(['Colleague Sam Okafor', 'Friend Jordan Bell']);
  });
});

describe('imports read birthdays and locations', () => {
  it('parses unambiguous birthdays and leaves the rest unmapped', () => {
    expect(parseBirthday('1990-03-14')).toEqual({ month: 3, day: 14, year: 1990 });
    expect(parseBirthday('19900314')).toEqual({ month: 3, day: 14, year: 1990 });
    expect(parseBirthday('--0314')).toEqual({ month: 3, day: 14, year: null });
    expect(parseBirthday('1604-03-14')).toEqual({ month: 3, day: 14, year: null });
    expect(parseBirthday('14/03/1990')).toEqual({ month: 3, day: 14, year: 1990 });
    expect(parseBirthday('03/14/1990')).toEqual({ month: 3, day: 14, year: 1990 });
    expect(parseBirthday('03/04/1990')).toBeNull();
    expect(parseBirthday('March 14, 1990')).toEqual({ month: 3, day: 14, year: 1990 });
    expect(parseBirthday('14 Mar')).toEqual({ month: 3, day: 14, year: null });
    expect(parseBirthday('2023-02-29')).toBeNull();
    expect(parseBirthday('soon')).toBeNull();
  });

  it('reads BDAY and the locality from ADR in a vCard, and Birthday and City from a CSV', () => {
    const cards = parseVcards('BEGIN:VCARD\nVERSION:3.0\nFN:Maya Chen\nEMAIL:maya@northstar.example\nBDAY:--0314\nADR;TYPE=HOME:;;1 Rua Augusta;Lisbon;;1100;Portugal\nEND:VCARD\n').rows;
    expect(cards[0]).toMatchObject({ birthday: { month: 3, day: 14, year: null }, location: 'Lisbon' });
    const csv = rowsFromTable(parseCsv('Name,Email,Birthday,City\nJordan Bell,jordan@fieldwork.example,1985-07-02,Austin\n'), 'csv').rows;
    expect(csv[0]).toMatchObject({ birthday: { month: 7, day: 2, year: 1985 }, location: 'Austin' });
  });

  it('fills an empty birthday and location on import but never overwrites what the owner wrote', async () => {
    const me = owner();
    const existing = (await call('save_person', { name: 'Jordan Bell', identifiers: [{ kind: 'email', value: 'jordan@fieldwork.example' }], location: 'Denver' }, me)).record;
    const file = 'Name,Email,Birthday,City\nJordan Bell,jordan@fieldwork.example,1985-07-02,Austin\nPriya Shah,priya@fieldwork.example,--0911,Austin\n';
    const preview = await call('preview_import', { fileName: 'contacts.csv', mimeType: 'text/csv', base64: Buffer.from(file).toString('base64') }, me);
    await call('apply_import', { previewId: preview.previewId, digest: preview.digest }, me);
    const jordan = (await call('get_person', { id: existing.id }, me)).person;
    expect(jordan).toMatchObject({ location: 'Denver', birthday: { month: 7, day: 2, year: 1985 } });
    const priya = (await call('search_people', { text: 'priya', limit: 5 }, me)).items[0];
    expect((await call('get_person', { id: priya.id }, me)).person).toMatchObject({ location: 'Austin', birthday: { month: 9, day: 11, year: null } });
  });
});

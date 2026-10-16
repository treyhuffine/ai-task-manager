import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Ctx } from '../src/domain/context.js';
import { parseCsv, parseVcards, rowsFromTable } from '../src/domain/imports/parse.js';
import { call, expectCode, owner, setup, teardown, chat } from './helpers.js';

let ctx: Ctx | null = null;
beforeEach(async () => { ctx = await setup(); });
afterEach(() => { teardown(ctx); ctx = null; });
const me = owner();
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

const LINKEDIN = `Notes:
"When exporting your connection data, you may notice that some of the email addresses are missing."

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Maya,Chen,https://www.linkedin.com/in/maya-chen-fictional,,Northstar,Design lead,12 Oct 2026
José,Álvarez,https://www.linkedin.com/in/jose-alvarez-fictional,jose@ejemplo.example,Fieldwork,Operations,03 Mar 2024
Priya,Shah,https://www.linkedin.com/in/priya-shah-fictional,priya@fieldwork.example,Fieldwork,"Operations, Delivery",01 Jan 2025
`;
const CSV = `Name,Email,Company,Title,Tags,Favourite colour,CRM ID
"Bell, Jordan",jordan@fieldwork.example,Fieldwork,Founder,Clients; Partners,Teal,crm-1
Elena Park,elena.park@proton.me,,Research lead,Collaborators,,crm-2
Elena Park,elena.park@proton.me,,Research lead,Collaborators,,crm-2
,,,,,,
Sam Okafor,not-an-email,Atlas Studio,Co-founder,,Navy,crm-4
`;
const VCARD = `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Kai Moreno\r\nN:Moreno;Kai;;;\r\nEMAIL;TYPE=work:kai@northstar.example\r\nORG:Northstar;Design\r\nTITLE:Researcher\r\nNOTE:Met at the design meetup\\, wants intros.\r\nCATEGORIES:Friends,Design\r\nX-CUSTOM:kept\r\nEND:VCARD\r\nBEGIN:VCARD\r\nVERSION:2.1\r\nFN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Ren=C3=A9e Dubois\r\nEMAIL:renee@example.org\r\nEND:VCARD\r\n`;

describe('parsers', () => {
  it('parses quoted CSV fields, embedded commas and semicolon delimiters', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    const { rows, mapping } = rowsFromTable(parseCsv(CSV), 'csv');
    expect(rows[0]).toMatchObject({ name: 'Bell, Jordan', emails: ['jordan@fieldwork.example'], company: 'Fieldwork', role: 'Founder', lists: ['Clients', 'Partners'], externalId: 'crm-1', unmapped: { 'Favourite colour': 'Teal' } });
    expect(mapping['CRM ID']).toBe('externalId');
  });
  it('parses vCard 3.0 and quoted-printable 2.1 cards, keeping unknown properties', () => {
    const { rows } = parseVcards(VCARD);
    expect(rows[0]).toMatchObject({ name: 'Kai Moreno', emails: ['kai@northstar.example'], company: 'Northstar', role: 'Researcher', notes: 'Met at the design meetup, wants intros.', lists: ['Friends', 'Design'], unmapped: { 'X-CUSTOM': 'kept' } });
    expect(rows[1].name).toBe('Renée Dubois');
  });
});

describe('import preview and apply', () => {
  it('previews a LinkedIn export with counts, company matches and dated roles, then applies exactly once', async () => {
    const existing = (await call('save_organization', { name: 'Fieldwork', website: 'fieldwork.example' }, me)).record;
    const preview = await call('preview_import', { fileName: 'Connections.csv', mimeType: 'text/csv', base64: b64(LINKEDIN) }, me);
    expect(preview.format).toBe('linkedin');
    expect(preview.counts).toEqual({ create: 3, update: 0, proposedMerge: 0, skipped: 0, unsupported: 0 });
    expect(preview.companies.find((company: { name: string }) => company.name === 'Fieldwork')).toMatchObject({ action: 'existing', organization: { id: existing.id } });
    expect(preview.note).toMatch(/snapshot/);
    expect(ctx!.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM persons')!.count).toBe(0);
    const applied = await call('apply_import', { previewId: preview.previewId, digest: preview.digest }, me);
    expect(applied.counts).toMatchObject({ created: 3, companies: 1 });
    const again = await call('apply_import', { previewId: preview.previewId, digest: preview.digest }, me);
    expect(again).toEqual(applied);
    const people = await call('list_people', { limit: 10 }, me);
    expect(people.items.map((item: { name: string }) => item.name)).toEqual(['José Álvarez', 'Maya Chen', 'Priya Shah']);
    const jose = people.items[0];
    expect(jose.company.name).toBe('Fieldwork');
    expect(jose.affiliationStatus).toBe('observed');
    const detail = await call('get_person', { id: jose.id }, me);
    expect(detail.affiliations[0]).toMatchObject({ observedAt: '2024-03-03T12:00:00.000Z', confidence: 'observed', status: 'unknown' });
    expect(detail.affiliations[0].description).toMatch(/Not confirmed as current/);
    // Re-importing the same file finds nothing new.
    const repeat = await call('preview_import', { fileName: 'Connections.csv', mimeType: 'text/csv', base64: b64(LINKEDIN) }, me);
    expect(repeat.counts).toMatchObject({ create: 0, skipped: 3 });
    expect(repeat.previouslyImported).toMatch(/LinkedIn export/);
  });

  it('previews duplicates, unsupported rows, updates and same-name merges, and keeps unmapped columns', async () => {
    await call('save_person', { name: 'Jordan Bell', identifiers: [{ kind: 'email', value: 'jordan@fieldwork.example' }] }, me);
    await call('save_person', { name: 'Sam Okafor' }, me);
    const preview = await call('preview_import', { fileName: 'crm.csv', mimeType: 'text/csv', base64: b64(CSV), listName: 'Imported' }, me);
    expect(preview.counts).toEqual({ create: 1, update: 1, proposedMerge: 1, skipped: 1, unsupported: 0 });
    expect(preview.rows.find((row: { name: string }) => row.name === 'Sam Okafor')).toMatchObject({ action: 'proposed_merge', invalid: ['not-an-email'] });
    expect(preview.unmapped).toContain('Favourite colour');
    const applied = await call('apply_import', { previewId: preview.previewId, digest: preview.digest }, me);
    expect(applied.counts).toMatchObject({ created: 2, updated: 1, skipped: 1 });
    expect((await call('list_people', { limit: 10, filters: { text: 'Sam' } }, me)).total).toBe(2);
    expect((await call('list_reviews', { kind: 'person', limit: 10 }, me)).items.length).toBe(1);
    const raw = ctx!.db.get<{ raw: string }>("SELECT raw FROM import_rows WHERE row_key = 'ext:csv:crm-1'")!;
    expect(JSON.parse(raw.raw).unmapped).toEqual({ 'Favourite colour': 'Teal' });
    const lists = (await call('list_lists', { limit: 10 }, me)).items.map((item: { name: string }) => item.name).sort();
    expect(lists).toEqual(['Clients', 'Collaborators', 'Imported', 'Partners']);
  });

  it('applies a vCard file with notes and lists into the chosen collection, and only the owner can import', async () => {
    const preview = await call('preview_import', { fileName: 'contacts.vcf', mimeType: 'text/vcard', base64: b64(VCARD) }, me);
    expect(preview.format).toBe('vcard');
    await call('apply_import', { previewId: preview.previewId, digest: preview.digest, decisions: [{ row: 2, action: 'skip' }] }, me);
    const kai = (await call('list_people', { limit: 10 }, me)).items[0];
    expect(kai.name).toBe('Kai Moreno');
    expect((await call('get_person', { id: kai.id }, me)).notes[0].body).toBe('Met at the design meetup, wants intros.');
    await expectCode(call('preview_import', { fileName: 'x.csv', mimeType: 'text/csv', base64: b64(CSV) }, chat('c', null)), 'forbidden');
    await expectCode(call('apply_import', { previewId: preview.previewId, digest: 'b'.repeat(64) }, me), 'conflict');
  });

  it('rejects files over the bound and empty files', async () => {
    await expectCode(call('preview_import', { fileName: 'empty.csv', mimeType: 'text/csv', base64: b64('   ') }, me), 'invalid_input');
  });
});

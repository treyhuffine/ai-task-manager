import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Ctx } from '../src/domain/context.js';
import { call, chat, owner, setup, teardown } from './helpers.js';

let ctx: Ctx | null = null;
beforeEach(async () => { ctx = await setup(); });
afterEach(() => { teardown(ctx); ctx = null; });

async function people() {
  const me = owner();
  const add = async (name: string) => (await call('save_person', { name }, me)).record as { id: string };
  return { me, maya: await add('Maya Chen'), samO: await add('Sam Okafor'), samR: await add('Sam Rivera'), jordan: await add('Jordan Bell') };
}
const notesOf = async (id: string, caller = owner()) => (await call('get_person', { id }, caller)).notes as { body: string; origin: string | null; originLabel: string | null }[];

describe('capture from chat', () => {
  it('files the user\'s exact words on the named person with where they came from, and applies stated details', async () => {
    const w = await people();
    const text = 'Had coffee with Maya. She moved to Lisbon and is hiring a research lead.';
    const result = await call('capture_about_person', { name: 'Maya Chen', text, details: { location: 'Lisbon' }, sourceLabel: 'Chat: Weekly catch-up' }, w.me);
    expect(result).toMatchObject({ status: 'saved', created: false, applied: ['note', 'location'], skipped: [] });
    expect(result.person.id).toBe(w.maya.id);
    const [note] = await notesOf(w.maya.id);
    expect(note).toMatchObject({ body: text, origin: 'chat', originLabel: 'Chat: Weekly catch-up' });
    expect((await call('get_person', { id: w.maya.id }, w.me)).person.location).toBe('Lisbon');
  });

  it('matches a first name when only one person has it, and records a stated relationship', async () => {
    const w = await people();
    const result = await call('capture_about_person', { name: 'maya', text: 'Jordan introduced me to Maya.', relation: { kind: 'introduced_by', relatedPersonId: w.jordan.id } }, w.me);
    expect(result.status).toBe('saved');
    expect(result.applied).toEqual(['note', 'relation']);
    expect((await call('get_person', { id: w.maya.id }, w.me)).relations[0]).toMatchObject({ label: 'Introduced by', person: { id: w.jordan.id } });
  });

  it('asks instead of guessing when a name matches several people, and saves nothing', async () => {
    const w = await people();
    const result = await call('capture_about_person', { name: 'Sam', text: 'Sam said the pilot starts in January.' }, w.me);
    expect(result.status).toBe('ambiguous');
    expect(result.candidates.map((item: { name: string }) => item.name).sort()).toEqual(['Sam Okafor', 'Sam Rivera']);
    expect(await notesOf(w.samO.id)).toEqual([]);
    expect(await notesOf(w.samR.id)).toEqual([]);
    // With the ID the user chose, it lands on that person.
    expect((await call('capture_about_person', { personId: w.samR.id, text: 'Sam said the pilot starts in January.' }, w.me)).status).toBe('saved');
    expect(await notesOf(w.samR.id)).toHaveLength(1);
  });

  it('adds someone new only when asked to, and never matches on a company or note', async () => {
    const w = await people();
    await call('save_note', { subjectKind: 'person', subjectId: w.jordan.id, body: 'Works closely with Priya.' }, w.me);
    expect((await call('capture_about_person', { name: 'Priya', text: 'Priya runs operations at Fieldwork.' }, w.me)).status).toBe('not_found');
    expect(await notesOf(w.jordan.id)).toHaveLength(1);
    const created = await call('capture_about_person', { name: 'Priya Shah', text: 'Priya runs operations at Fieldwork.', createIfMissing: true, details: { headline: 'Operations' } }, w.me);
    expect(created).toMatchObject({ status: 'saved', created: true });
    expect(created.person.name).toBe('Priya Shah');
  });

  it('is safe to retry: the same invocation saves one note', async () => {
    const w = await people();
    const input = { personId: w.jordan.id, text: 'Jordan prefers a written plan before calls.' };
    await call('capture_about_person', input, w.me, '0194d7a0-0000-4000-8000-00000000c001');
    await call('capture_about_person', input, w.me, '0194d7a0-0000-4000-8000-00000000c001');
    expect(await notesOf(w.jordan.id)).toHaveLength(1);
  });

  it('a read-only chat is refused, and a chat never captures onto someone it can\'t see', async () => {
    const w = await people();
    const side = (await call('save_collection', { label: 'Side project' }, w.me)).key;
    const scoped = chat('c', (await call('create_scope', { actorId: 'chat:c', sources: [side, 'manual'], operations: ['read'] }, w.me)).scopeRef);
    const writer = chat('d', (await call('create_scope', { actorId: 'chat:d', sources: [side], operations: ['read', 'write'] }, w.me)).scopeRef);
    // Chat c may read but not write: capturing is refused outright.
    await expect(call('capture_about_person', { personId: w.jordan.id, text: 'Jordan moved.' }, scoped)).rejects.toThrow();
    // Chat d may write only its own collection and can't see Jordan in the main one.
    expect((await call('capture_about_person', { name: 'Jordan Bell', text: 'Jordan moved.' }, writer)).status).toBe('not_found');
  });
});

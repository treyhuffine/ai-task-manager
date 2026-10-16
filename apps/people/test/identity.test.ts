import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseGmailMessage, type CalendarEvent } from '@ri/app-kit/sources';
import type { Ctx } from '../src/domain/context.js';
import { ingestEvent, ingestMail } from '../src/domain/interactions.js';
import { findKey, normalizeIdentifier, personForEmail } from '../src/domain/identity.js';
import { calendarEvent, gmailRaw, type FakeMail } from '../src/fixtures/mail.js';
import { call, owner, setup, teardown } from './helpers.js';

let ctx: Ctx | null = null;
beforeEach(async () => { ctx = await setup(); });
afterEach(() => { teardown(ctx); ctx = null; });

const OWNERS = new Set(['owner@example.test']);
let n = 0;
function deliver(source: string, partial: Partial<FakeMail> & Pick<FakeMail, 'from' | 'to'>) {
  const message = parseGmailMessage(gmailRaw({ id: `m${++n}`, subject: 'Hello', body: 'Hello there', date: '2026-10-10T15:00:00.000Z', ...partial }));
  return ctx!.db.tx(() => ingestMail(ctx!, source, message, OWNERS));
}
const sent = (to: string[], extra: Partial<FakeMail> = {}) => deliver('account:a', { from: 'owner@example.test', to, sent: true, ...extra });
const people = async () => (await call('list_people', { limit: 100 }, owner())).items as { id: string; name: string; company: { name: string } | null; revision: number }[];

describe('identity rules', () => {
  it('Email normalization: trims whitespace and lower-cases only the domain, never strips dots or plus suffixes', () => {
    expect(normalizeIdentifier('email', '  Maya.Chen+work@NorthStar.Example ')).toBe('Maya.Chen+work@northstar.example');
    sent(['maya.chen+work@northstar.example', 'mayachen@northstar.example', 'Maya.Chen+work@NORTHSTAR.example']);
    expect(findKey(ctx!, 'email', 'maya.chen+work@northstar.example')).not.toBeNull();
    expect(personForEmail(ctx!, 'maya.chen+work@northstar.example')).not.toBe(personForEmail(ctx!, 'mayachen@northstar.example'));
    // Differently cased local parts are different keys: aliases are explicit, never assumed.
    expect(personForEmail(ctx!, 'Maya.Chen+work@northstar.example')).not.toBe(personForEmail(ctx!, 'maya.chen+work@northstar.example'));
  });

  it('Exact normalized email: associates with its existing identity and preserves the original value', async () => {
    ctx!.accounts.setup({ account: 'a', kind: 'mail', historyDays: 90, label: 'Personal Gmail' });
    ctx!.accounts.setup({ account: 'b', kind: 'mail', historyDays: 90, label: 'Work Gmail' });
    sent(['Maya Chen <Maya@NorthStar.example>']);
    deliver('account:b', { from: 'Maya Chen <Maya@northstar.EXAMPLE>', to: ['owner@example.test'] });
    const list = await people();
    expect(list.filter((person) => person.name === 'Maya Chen').length).toBe(1);
    const detail = await call('get_person', { id: list[0].id }, owner());
    expect(detail.identities[0].value).toBe('Maya@NorthStar.example');
    expect(detail.identities[0].sources.length).toBe(2);
  });

  it('Same name or company domain: suggests a match and never merges people automatically', async () => {
    sent(['Sam Lee <sam@atlas.example>']);
    sent(['Sam Lee <sam.lee@other.example>']);
    const list = await people();
    expect(list.filter((person) => person.name === 'Sam Lee').length).toBe(2);
    const reviews = await call('list_reviews', { kind: 'person', limit: 10 }, owner());
    expect(reviews.items.length).toBe(1);
    expect(reviews.items[0].reason).toBe('same_name');
    expect(reviews.items[0].summary).toMatch(/does not show they are the same/);
  });

  it('New address in a signature: proposes an alias with evidence and cannot replace a confirmed identity', async () => {
    sent(['Maya Chen <maya@northstar.example>']);
    deliver('account:a', { from: 'Maya Chen <maya@northstar.example>', to: ['owner@example.test'], body: 'Sounds good.\n\nBest,\nMaya Chen\nDesign lead, Northstar\nmaya.chen@northstar.example' });
    const reviews = await call('list_reviews', { kind: 'alias', limit: 10 }, owner());
    expect(reviews.items[0].identifier).toBe('maya.chen@northstar.example');
    expect(reviews.items[0].passage).toContain('maya.chen@northstar.example');
    expect(personForEmail(ctx!, 'maya.chen@northstar.example')).toBeNull();
    expect((await call('list_people', { limit: 10, filters: { text: 'maya' } }, owner())).total).toBe(1);
    await call('resolve_identity', { reviewId: reviews.items[0].id, expectedRevision: reviews.items[0].revision, decision: 'accept' }, owner());
    expect(personForEmail(ctx!, 'maya.chen@northstar.example')).toBe(personForEmail(ctx!, 'maya@northstar.example'));
  });

  it('Shared inbox such as support@: marked shared and never equated with an employee', async () => {
    sent(['Support <support@fieldwork.example>', 'Jordan Bell <jordan@fieldwork.example>']);
    const list = await people();
    expect(list.map((person) => person.name)).toEqual(['Jordan Bell']);
    expect(findKey(ctx!, 'email', 'support@fieldwork.example')!.shared).toBe(true);
  });

  it('Company name or website: proposes an organization match, and two organizations may share a name or domain', async () => {
    const one = await call('save_organization', { name: 'Atlas Studio', website: 'atlas.example' }, owner());
    const two = await call('save_organization', { name: 'Atlas Studio Inc', website: 'atlas.example' }, owner());
    expect(one.record.id).not.toBe(two.record.id);
    ctx!.db.tx(() => { const { proposeOrganizationMatches } = require_reviews(); proposeOrganizationMatches(ctx!, two.record.id, 'manual'); });
    const reviews = await call('list_reviews', { kind: 'organization', limit: 10 }, owner());
    // One review per pair, whichever signal found it first. Nothing is merged.
    expect(reviews.items.length).toBe(1);
    expect(['same_name', 'same_domain']).toContain(reviews.items[0].reason);
    expect((await call('list_organizations', { limit: 10 }, owner())).total).toBe(2);
  });

  it('Gmail address or shared email provider: never infers a company from the provider domain', async () => {
    await call('save_organization', { name: 'Gmail fans', website: 'example.org' }, owner());
    await expect(call('save_organization', { name: 'Google mail', website: 'gmail.com' }, owner())).rejects.toThrow(/shared mail provider/);
    sent(['Alex Rivera <alex.rivera@gmail.com>']);
    const alex = (await people()).find((person) => person.name === 'Alex Rivera')!;
    expect(alex.company).toBeNull();
    expect(ctx!.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM affiliations')!.count).toBe(0);
  });

  it('Signature, contact import or stated employer: keeps the observed date and provenance, distinct from confirmed current employment', async () => {
    sent(['Maya Chen <maya@northstar.example>']);
    deliver('account:a', { from: 'Maya Chen <maya@northstar.example>', to: ['owner@example.test'], body: 'Thanks.\n\nBest,\nMaya Chen\nDesign lead, Northstar', date: '2026-03-02T10:00:00.000Z' });
    const maya = (await people())[0];
    const detail = await call('get_person', { id: maya.id }, owner());
    expect(detail.header.company).toBeNull();
    const fact = detail.facts.find((item: { field: string }) => item.field === 'affiliation');
    expect(fact.status).toBe('suggested');
    expect(fact.observedAt).toBe('2026-03-02T10:00:00.000Z');
    expect(fact.passage).toContain('Design lead, Northstar');
    const accepted = await call('review_fact', { id: fact.id, expectedRevision: fact.revision, decision: 'accept' }, owner());
    expect(accepted.record.status).toBe('active');
    const after = await call('get_person', { id: maya.id }, owner());
    expect(after.header.company.name).toBe('Northstar');
    expect(after.affiliations[0].confidence).toBe('confirmed');
  });

  it('Calendar attendee: attributes to that event, and co-attendance alone establishes no relationship or employer', async () => {
    ctx!.db.tx(() => ingestEvent(ctx!, 'account:a', 'primary', calendarEvent({ id: 'ev1', summary: 'Kickoff', start: '2026-10-20T16:00:00.000Z', end: '2026-10-20T17:00:00.000Z', attendees: [{ email: 'owner@example.test', self: true }, { email: 'kim@fieldwork.example', displayName: 'Kim Ito' }, { email: 'li@northstar.example', displayName: 'Li Wen' }] }) as unknown as CalendarEvent, null));
    expect(ctx!.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM affiliations')!.count).toBe(0);
    expect(ctx!.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM interaction_links')!.count).toBe(0);
    const kim = (await people()).find((person) => person.name === 'Kim Ito')!;
    expect(kim.company).toBeNull();
  });

  it('Manual correction: takes precedence over inference and survives resync and re-extraction', async () => {
    sent(['Maya Chen <maya@northstar.example>']);
    const maya = (await people())[0];
    await call('save_person', { id: maya.id, expectedRevision: maya.revision, name: 'Maya Chen-Ortiz' }, owner());
    deliver('account:a', { from: 'Maya Chen <maya@northstar.example>', to: ['owner@example.test'], body: 'New message' });
    deliver('account:b', { from: 'M. Chen <maya@northstar.example>', to: ['owner@example.test'], body: 'Another account' });
    expect((await people())[0].name).toBe('Maya Chen-Ortiz');
  });

  it('creates people only from sent mail, confirmed direct replies and small meetings, and keeps user exclusions', async () => {
    deliver('account:a', { from: 'Cold Caller <cold@vendor.example>', to: ['owner@example.test'] });
    expect(await people()).toEqual([]);
    sent(Array.from({ length: 12 }, (_, index) => `guest${index}@party.example`));
    expect(await people()).toEqual([]);
    await call('save_exclusion', { value: 'cold@vendor.example', kind: 'sender', decision: 'excluded' }, owner());
    sent(['Cold Caller <cold@vendor.example>']);
    expect(await people()).toEqual([]);
    const head = sent(['Ana Ruiz <ana@studio.example>'], { messageId: '<thread-1@example.test>' });
    expect(head.persons.size).toBe(1);
    deliver('account:a', { from: 'Ben Ode <ben@studio.example>', to: ['owner@example.test'], inReplyTo: '<thread-1@example.test>' });
    expect((await people()).map((person) => person.name).sort()).toEqual(['Ana Ruiz', 'Ben Ode']);
  });
});

// Imported lazily so the test file reads top-down like the rules table.
import * as reviews from '../src/domain/reviews.js';
function require_reviews() { return reviews; }

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Ctx } from '../src/domain/context.js';
import { call, fixture, setup, teardown } from './helpers.js';

let ctx: Ctx | null = null;
beforeEach(async () => { ctx = await setup(); });
afterEach(() => { teardown(ctx); ctx = null; });

describe('fictional preview', () => {
  it('seeds the concept world on first open by a preview principal and shows the whole workflow', async () => {
    const opened = await call('open_view', { path: '/today', query: {} }, fixture());
    expect(opened.data.fixture).toBe(true);
    expect(opened.data.setup.people).toBe(6);
    expect(opened.scope.actions).toContain('save_person');
    expect(opened.scope.actions).not.toContain('run_background_step');
    const again = await call('open_view', { path: '/', query: {} }, fixture());
    expect(again.data.setup.people).toBe(6);

    const today = await call('get_today', {}, fixture());
    expect(today.empty).toBe(false);
    expect(today.meetings[0].title).toBe('Portfolio discussion');
    expect(today.meetings[0].people[0].name).toBe('Maya Chen');
    expect(today.iOwe.length).toBeGreaterThan(0);
    expect(today.waitingOn[0].commitment.action).toBe('Send the project access details');

    const people = await call('list_people', { limit: 50 }, fixture());
    expect(people.items.map((item: { name: string }) => item.name)).toEqual(['Alex Rivera', 'Elena Park', 'Jordan Bell', 'Maya Chen', 'Priya Shah', 'Sam Okafor']);
    const maya = people.items.find((item: { name: string }) => item.name === 'Maya Chen');
    expect(maya.company.name).toBe('Northstar');
    expect(maya.affiliationStatus).toBe('observed');
    const alex = people.items.find((item: { name: string }) => item.name === 'Alex Rivera');
    expect(alex.company).toBeNull();
    expect(alex.role).toBe('Independent consultant');

    const detail = await call('get_person', { id: maya.id }, fixture());
    expect(detail.header.affiliationNote).toMatch(/observed/);
    expect(detail.header.nextMeeting.title).toBe('Portfolio discussion');
    expect(detail.commitments[0].confirmation).toBe('No confirming message found in the indexed history');
    expect(detail.reviews.length).toBe(1);

    const timeline = await call('list_interactions', { subjectKind: 'person', subjectId: maya.id, limit: 20 }, fixture());
    expect(timeline.items.some((item: { label: string }) => item.label === 'Meeting scheduled')).toBe(true);
    expect(timeline.items.some((item: { label: string }) => item.label === 'Your note')).toBe(true);

    const companies = await call('list_organizations', { limit: 50 }, fixture());
    const fieldwork = companies.items.find((item: { name: string }) => item.name === 'Fieldwork');
    expect(fieldwork.peopleCount).toBe(2);
    const company = await call('get_organization', { id: fieldwork.id }, fixture());
    expect(company.people.current.map((item: { personName: string }) => item.personName).sort()).toEqual(['Jordan Bell', 'Priya Shah']);
    expect(company.opportunities.length).toBe(2);
    expect(company.commitments.some((item: { direction: string }) => item.direction === 'waiting_on')).toBe(true);
    const activity = await call('list_interactions', { subjectKind: 'organization', subjectId: fieldwork.id, limit: 20, include: ['email'] }, fixture());
    expect(activity.items.length).toBe(1);

    const pipelines = await call('list_pipelines', {}, fixture());
    expect(pipelines.items[0].stages.map((stage: { label: string }) => stage.label)).toEqual(['Exploring', 'Discussing', 'Proposal', 'Won', 'Closed']);
    const opportunities = await call('list_opportunities', { limit: 100, filters: { pipelineId: pipelines.items[0].id } }, fixture());
    expect(opportunities.items.length).toBe(3);

    const briefing = await call('get_briefing', { subjectKind: 'person', subjectId: maya.id }, fixture());
    expect(briefing.title).toBe('Before you meet');
    expect(briefing.origin).toBe('saved_records');
    const context = await call('get_relationship_context', { subjectKind: 'person', subjectId: maya.id }, fixture());
    expect(context.items.length).toBeGreaterThan(0);
    const view = await call('describe_view_context', { path: `/people/${maya.id}`, query: {}, state: { section: 'person', selected: [] } }, fixture());
    expect(view.modelContent).toContain('Maya Chen');
    const sources = await call('list_sources', {}, fixture());
    // The preview's own invented accounts read as granted and up to date. No real account is involved.
    expect(sources.accounts.map((account: { label: string; kind: string; granted: boolean }) => `${account.label} ${account.kind} ${account.granted}`))
      .toEqual(['Personal Gmail mail true', 'Personal Gmail calendar true', 'Work Gmail mail true']);
    expect(sources.largeEvents).toBe(1);
    const followUps = await call('list_commitments', { filter: 'suggestions', limit: 50 }, fixture());
    expect(followUps.items.length).toBe(1);
    // Follow-ups in the preview stay fictional: no Ri task is created or read (the fixture caller has no capabilities).
    const owed = await call('list_commitments', { filter: 'i_owe', limit: 50 }, fixture());
    const open = owed.items.find((item: { kind: string; commitment?: { action: string } }) => item.kind === 'commitment' && /research plan/.test(item.commitment!.action)).commitment;
    const created = await call('create_follow_up', { subject: { kind: 'commitment', id: open.id }, title: 'Share the research plan outline', operationId: '0194d7a0-0000-7000-8000-00000000f001' }, fixture());
    expect(created.link.status).toBe('linked');
    expect(created.link.taskId).toBe('0194d7a0-0000-7000-8000-00000000f001');
    const checked = await call('check_follow_ups', { ids: [created.link.id] }, fixture());
    expect(checked.items[0].status).toBe('linked');
    const exported = await call('export_records', { table: 'people' }, fixture());
    expect(exported.content.split('\n')[0]).toMatch(/^format_version,id,name/);
    const reviews = await call('list_reviews', { limit: 20 }, fixture());
    expect(reviews.items.some((item: { kind: string }) => item.kind === 'alias')).toBe(true);
    const search = await call('search_people', { text: 'field', limit: 20, includeOrganizations: true }, fixture());
    expect(search.items.map((item: { name: string }) => item.name).sort()).toEqual(['Jordan Bell', 'Priya Shah']);
    expect(search.organizations[0].name).toBe('Fieldwork');
  });
});

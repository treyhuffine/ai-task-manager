import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Ctx } from '../src/domain/context.js';
import { call, expectCode, owner, setup, teardown } from './helpers.js';
import { fakeHost } from './fakes.js';

let ctx: Ctx | null = null;
beforeEach(async () => { ctx = await setup(); });
afterEach(() => { teardown(ctx); ctx = null; });
const me = owner();

async function pipeline() {
  const record = (await call('save_pipeline', { name: 'Client work', template: 'client_work' }, me)).record;
  const stage = (label: string) => record.stages.find((item: { label: string }) => item.label === label)!.id as string;
  return { record, stage };
}

describe('optional pipelines', () => {
  it('templates are editable suggestions over the same fields with stable stage IDs', async () => {
    const custom = await call('save_pipeline', { name: 'Fundraising', template: 'blank', stages: [{ label: 'Intro', kind: 'open' }, { label: 'Partner meeting', kind: 'open' }, { label: 'Term sheet', kind: 'succeeded' }, { label: 'Passed', kind: 'closed' }] }, me);
    expect(custom.record.stages.map((stage: { label: string }) => stage.label)).toEqual(['Intro', 'Partner meeting', 'Term sheet', 'Passed']);
    const { record, stage } = await pipeline();
    expect(record.stages.map((item: { kind: string }) => item.kind)).toEqual(['open', 'open', 'open', 'succeeded', 'closed']);
    const renamed = await call('save_pipeline_stages', { pipelineId: record.id, expectedRevision: record.revision, stages: record.stages.map((item: { id: string; label: string; kind: string }) => ({ id: item.id, label: item.label === 'Proposal' ? 'Proposal sent' : item.label, kind: item.kind })).reverse() }, me);
    expect(renamed.record.stages.find((item: { id: string }) => item.id === stage('Proposal')).label).toBe('Proposal sent');
    expect(renamed.record.stages[0].label).toBe('Closed');
  });

  it('a deleted stage cannot orphan opportunities: removal needs a replacement and is recorded in history', async () => {
    const { record, stage } = await pipeline();
    const opportunity = (await call('save_opportunity', { title: 'Onboarding project', pipelineId: record.id, stageId: stage('Discussing') }, me)).record;
    const without = record.stages.filter((item: { label: string }) => item.label !== 'Discussing').map((item: { id: string; label: string; kind: string }) => ({ id: item.id, label: item.label, kind: item.kind }));
    await expectCode(call('save_pipeline_stages', { pipelineId: record.id, expectedRevision: record.revision, stages: without }, me), 'invalid_input');
    await call('save_pipeline_stages', { pipelineId: record.id, expectedRevision: record.revision, stages: without, replacements: [{ stageId: stage('Discussing'), replacementStageId: stage('Exploring') }] }, me);
    const detail = await call('get_opportunity', { id: opportunity.id }, me);
    expect(detail.opportunity.stageLabel).toBe('Exploring');
    expect(detail.history[0].reason).toMatch(/Stage Discussing was removed/);
  });

  it('concurrent stage moves use revision checks and moves append history', async () => {
    const { record, stage } = await pipeline();
    const opportunity = (await call('save_opportunity', { title: 'Research workshop', pipelineId: record.id }, me)).record;
    const first = await call('move_opportunity', { id: opportunity.id, expectedRevision: opportunity.revision, stageId: stage('Proposal') }, me);
    expect(first.status).toBe('saved');
    const second = await call('move_opportunity', { id: opportunity.id, expectedRevision: opportunity.revision, stageId: stage('Won') }, me);
    expect(second.status).toBe('conflict');
    expect(second.current.stageLabel).toBe('Proposal');
    const history = (await call('get_opportunity', { id: opportunity.id }, me)).history;
    expect(history.map((item: { toStage: string }) => item.toStage)).toEqual(['Proposal', 'Exploring']);
    expect(history[0].actor).toBe('You');
  });

  it('moving to another pipeline requires a destination stage there', async () => {
    const one = await pipeline();
    const two = (await call('save_pipeline', { name: 'Introductions', template: 'introductions' }, me)).record;
    const opportunity = (await call('save_opportunity', { title: 'Intro to research lead', pipelineId: one.record.id }, me)).record;
    await expectCode(call('move_opportunity', { id: opportunity.id, expectedRevision: opportunity.revision, stageId: one.stage('Proposal'), pipelineId: two.id }, me), 'invalid_input');
    const moved = await call('move_opportunity', { id: opportunity.id, expectedRevision: opportunity.revision, stageId: two.stages[1].id, pipelineId: two.id }, me);
    expect(moved.record.pipelineId).toBe(two.id);
  });

  it('values use integer minor units with an explicit currency and two currencies are never summed', async () => {
    const { record } = await pipeline();
    await call('save_opportunity', { title: 'US project', pipelineId: record.id, value: { minor: 800000, currency: 'USD' } }, me);
    await call('save_opportunity', { title: 'EU project', pipelineId: record.id, value: { minor: 500000, currency: 'EUR' } }, me);
    await expect(call('save_opportunity', { title: 'Bad', pipelineId: record.id, value: { minor: 1.5, currency: 'USD' } }, me)).rejects.toThrow();
    const list = await call('list_pipelines', {}, me);
    expect(JSON.stringify(list)).not.toMatch(/1300000|total/i);
    const values = (await call('list_opportunities', { limit: 10 }, me)).items.map((item: { value: { minor: number; currency: string } }) => item.value);
    expect(values).toEqual(expect.arrayContaining([{ minor: 800000, currency: 'USD' }, { minor: 500000, currency: 'EUR' }]));
  });

  it('closing an opportunity does not complete its Ri task, and hiding Pipelines keeps records and follow-ups', async () => {
    const host = fakeHost({});
    const { record, stage } = await pipeline();
    const opportunity = (await call('save_opportunity', { title: 'Onboarding project', pipelineId: record.id, nextAction: 'Send revised proposal', nextActionDate: '2026-10-16' }, me)).record;
    const follow = await call('create_follow_up', { subject: { kind: 'opportunity', id: opportunity.id }, title: 'Send revised proposal', dueAt: '2026-10-16' }, owner([], host.capability));
    await call('move_opportunity', { id: opportunity.id, expectedRevision: opportunity.revision + 1, stageId: stage('Won') }, me);
    expect(host.tasks.get(follow.link.operationId)!.status).toBe('open');
    await call('save_navigation', { pipelines: 'shown' }, me);
    await call('save_navigation', { pipelines: 'hidden' }, me);
    const after = await call('get_opportunity', { id: opportunity.id }, me);
    expect(after.opportunity.taskLink.taskId).toBe(follow.link.taskId);
    expect(after.opportunity.closed).toBe(true);
  });
});

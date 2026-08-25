import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  optimisticPatch,
  optimisticRemove,
  projectPatchToList,
  rollbackOptimistic,
} from './optimistic-entity';
import { LIST_BODY_EXCERPT_CHARS } from '@/lib/api/dto/entity-list';

const ACTIVE = { status: 'active' };
const DONE = { status: 'done' };

function seed() {
  const qc = new QueryClient();
  // Single-entity caches (full record, with body).
  qc.setQueryData(['tasks', 't1'], { id: 't1', status: 'active', body: 'hello', title: 'A' });
  qc.setQueryData(['tasks', 't2'], { id: 't2', status: 'active', body: 'world', title: 'B' });
  // List caches (DTOs: no body, carry bodyExcerpt/bodyLen).
  qc.setQueryData(['tasks', ACTIVE], [
    { id: 't1', status: 'active', bodyExcerpt: 'hello', bodyLen: 5, title: 'A' },
    { id: 't2', status: 'active', bodyExcerpt: 'world', bodyLen: 5, title: 'B' },
  ]);
  qc.setQueryData(['tasks', DONE], [] as unknown[]);
  // A different root must never be touched.
  qc.setQueryData(['notes', 'n1'], { id: 'n1', body: 'note', title: 'N' });
  return qc;
}

describe('projectPatchToList', () => {
  it('passes non-body patches through untouched', () => {
    expect(projectPatchToList({ status: 'done', areaId: 'a1' })).toEqual({
      status: 'done',
      areaId: 'a1',
    });
  });

  it('translates body into excerpt + length and drops the raw body', () => {
    const out = projectPatchToList({ title: 'X', body: 'abcdef' });
    expect(out).toEqual({ title: 'X', bodyExcerpt: 'abcdef', bodyLen: 6 });
    expect('body' in out).toBe(false);
  });

  it('clamps the excerpt to LIST_BODY_EXCERPT_CHARS', () => {
    const long = 'z'.repeat(LIST_BODY_EXCERPT_CHARS + 50);
    const out = projectPatchToList({ body: long });
    expect(out.bodyExcerpt).toHaveLength(LIST_BODY_EXCERPT_CHARS);
    expect(out.bodyLen).toBe(long.length);
  });

  it('represents an emptied body as a null excerpt', () => {
    expect(projectPatchToList({ body: '' })).toEqual({ bodyExcerpt: null, bodyLen: 0 });
    expect(projectPatchToList({ body: null })).toEqual({ bodyExcerpt: null, bodyLen: 0 });
  });
});

describe('optimisticPatch', () => {
  it('merges a field into the single-entity cache and every list, sparing other ids', async () => {
    const qc = seed();
    await optimisticPatch(qc, 'tasks', 't1', { status: 'done' });

    expect(qc.getQueryData(['tasks', 't1'])).toMatchObject({ id: 't1', status: 'done' });
    const list = qc.getQueryData<Array<{ id: string; status: string }>>(['tasks', ACTIVE])!;
    expect(list.find((t) => t.id === 't1')!.status).toBe('done');
    // Untouched neighbours.
    expect(qc.getQueryData(['tasks', 't2'])).toMatchObject({ status: 'active' });
    expect(list.find((t) => t.id === 't2')!.status).toBe('active');
  });

  it('writes body into the single cache but projects it to an excerpt in lists', async () => {
    const qc = seed();
    await optimisticPatch(qc, 'tasks', 't1', { body: 'brand new body' });

    // Single cache keeps the raw body (this is what the editor already holds).
    expect(qc.getQueryData(['tasks', 't1'])).toMatchObject({ body: 'brand new body' });
    // List cache gets excerpt/len, never a raw body field.
    const row = qc
      .getQueryData<Array<Record<string, unknown>>>(['tasks', ACTIVE])!
      .find((t) => t.id === 't1')!;
    expect(row.bodyExcerpt).toBe('brand new body');
    expect(row.bodyLen).toBe('brand new body'.length);
    expect('body' in row).toBe(false);
  });

  it('never touches a different entity root', async () => {
    const qc = seed();
    const before = qc.getQueryData(['notes', 'n1']);
    await optimisticPatch(qc, 'tasks', 't1', { status: 'done' });
    expect(qc.getQueryData(['notes', 'n1'])).toBe(before);
  });

  it('returns a snapshot that rolls the cache back exactly', async () => {
    const qc = seed();
    const beforeT1 = qc.getQueryData(['tasks', 't1']);
    const beforeList = qc.getQueryData(['tasks', ACTIVE]);

    const snapshot = await optimisticPatch(qc, 'tasks', 't1', { status: 'done', title: 'ZZ' });
    expect(qc.getQueryData(['tasks', 't1'])).toMatchObject({ status: 'done', title: 'ZZ' });

    rollbackOptimistic(qc, snapshot);
    expect(qc.getQueryData(['tasks', 't1'])).toEqual(beforeT1);
    expect(qc.getQueryData(['tasks', ACTIVE])).toEqual(beforeList);
  });
});

describe('optimisticRemove', () => {
  it('drops the row from lists and removes the single-entity cache', async () => {
    const qc = seed();
    await optimisticRemove(qc, 'tasks', 't1');

    const list = qc.getQueryData<Array<{ id: string }>>(['tasks', ACTIVE])!;
    expect(list.map((t) => t.id)).toEqual(['t2']);
    expect(qc.getQueryData(['tasks', 't1'])).toBeUndefined();
    // Neighbour survives.
    expect(qc.getQueryData(['tasks', 't2'])).toMatchObject({ id: 't2' });
  });

  it('rolls back a removal from its snapshot', async () => {
    const qc = seed();
    const beforeList = qc.getQueryData(['tasks', ACTIVE]);
    const beforeT1 = qc.getQueryData(['tasks', 't1']);

    const snapshot = await optimisticRemove(qc, 'tasks', 't1');
    rollbackOptimistic(qc, snapshot);

    expect(qc.getQueryData(['tasks', ACTIVE])).toEqual(beforeList);
    expect(qc.getQueryData(['tasks', 't1'])).toEqual(beforeT1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NoteRecord, TaskRecord } from '@/db/types';

const runHarnessJson = vi.fn();
vi.mock('@/lib/harness/one-shot', () => ({
  runHarnessJson: (...args: unknown[]) => runHarnessJson(...args),
  resolveBackgroundHarness: () => 'claude',
  backgroundModelFor: () => 'opus',
}));

let workDir: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-briefs-'));
  process.env.RI_WORK_DIR = workDir;
  runHarnessJson.mockReset();
});

afterEach(() => {
  delete process.env.RI_WORK_DIR;
  fs.rmSync(workDir, { recursive: true, force: true });
});

const LONG_BODY = Array.from({ length: 40 }, (_, i) => `Line ${i}: a sentence with enough words to matter.`).join('\n');

function note(over: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id: 'note_1',
    title: 'Assistant MVP requirements',
    body: LONG_BODY,
    status: 'active',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  } as NoteRecord;
}

function task(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task_1',
    title: 'Ship the brief',
    body: LONG_BODY,
    description: null,
    outcome: null,
    userContext: null,
    status: 'todo',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  } as TaskRecord;
}

const CONTENT = {
  summary: 'Your running notebook on the assistant MVP.',
  points: ['GBrain and memory are the newest threads.'],
  open: ['Markdown or database as the source of truth?'],
  suggestions: ['Pull the GBrain notes into their own section'],
};

describe('briefContentHash', () => {
  it('changes with the body and title, not with live properties', async () => {
    const { briefContentHash } = await import('./brief');
    const base = briefContentHash('task', task());
    expect(briefContentHash('task', task({ status: 'in_progress', hardDeadline: '2026-10-01' }))).toBe(base);
    expect(briefContentHash('task', task({ body: LONG_BODY + '\nmore' }))).not.toBe(base);
    expect(briefContentHash('task', task({ title: 'Renamed' }))).not.toBe(base);
  });

  it('ignores whitespace-only differences (the editor re-serializes on mount)', async () => {
    const { briefContentHash } = await import('./brief');
    const base = briefContentHash('note', note());
    expect(briefContentHash('note', note({ body: LONG_BODY.replace(/\n/g, '\n\n') + '  ' }))).toBe(base);
    expect(briefContentHash('note', note({ title: '  Assistant MVP requirements ' }))).toBe(base);
  });

  it('includes task-only content fields (outcome, description, context)', async () => {
    const { briefContentHash } = await import('./brief');
    const base = briefContentHash('task', task());
    expect(briefContentHash('task', task({ outcome: 'Done when shipped' }))).not.toBe(base);
    expect(briefContentHash('task', task({ userContext: 'blocks launch' }))).not.toBe(base);
  });
});

describe('getBriefState', () => {
  it('reports inline for short documents without touching the cache', async () => {
    const { getBriefState } = await import('./brief');
    const state = getBriefState('note', note({ body: 'Buy oat milk' }));
    expect(state.status).toBe('inline');
    expect(state.brief).toBeNull();
    expect(fs.existsSync(path.join(workDir, 'briefs'))).toBe(false);
  });

  it('reports missing, then fresh after generation, then stale after an edit', async () => {
    const { getBriefState, generateBrief } = await import('./brief');
    runHarnessJson.mockResolvedValue(CONTENT);

    expect(getBriefState('note', note()).status).toBe('missing');

    const brief = await generateBrief('note', note());
    expect(brief.summary).toBe(CONTENT.summary);
    expect(brief.entityType).toBe('note');
    expect(brief.entityId).toBe('note_1');

    const fresh = getBriefState('note', note());
    expect(fresh.status).toBe('fresh');
    expect(fresh.brief?.contentHash).toBe(fresh.contentHash);

    const stale = getBriefState('note', note({ body: LONG_BODY + '\nA new thought.' }));
    expect(stale.status).toBe('stale');
    // The old brief still rides along so the UI can show it while regenerating.
    expect(stale.brief?.summary).toBe(CONTENT.summary);
    expect(stale.brief?.contentHash).not.toBe(stale.contentHash);
  });

  it('writes the cache under the work dir, per type and id', async () => {
    const { generateBrief } = await import('./brief');
    runHarnessJson.mockResolvedValue(CONTENT);
    await generateBrief('task', task());
    const file = path.join(workDir, 'briefs', 'task', 'task_1.json');
    expect(fs.existsSync(file)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(parsed.version).toBe(1);
    expect(parsed.points).toEqual(CONTENT.points);
  });

  it('ignores a corrupt or foreign cache file', async () => {
    const { getBriefState } = await import('./brief');
    const file = path.join(workDir, 'briefs', 'note', 'note_1.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"version": 99, "contentHash": "x"}');
    expect(getBriefState('note', note()).status).toBe('missing');
    fs.writeFileSync(file, 'not json');
    expect(getBriefState('note', note()).status).toBe('missing');
  });
});

describe('generateBrief', () => {
  it('sends the system prompt, the document, and the JSON shape to the harness on the standard tier', async () => {
    const { generateBrief } = await import('./brief');
    runHarnessJson.mockResolvedValue(CONTENT);
    await generateBrief('task', task({ outcome: 'A cached brief per entity' }));
    const opts = runHarnessJson.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.label).toBe('entity-brief');
    expect(opts.tier).toBe('standard');
    expect(String(opts.prompt)).toContain('Title: Ship the brief');
    expect(String(opts.prompt)).toContain('Outcome (definition of done): A cached brief per entity');
    expect(String(opts.prompt)).toContain('<task_body>');
    expect(String(opts.system)).toContain('Never invent');
    expect(String(opts.shape)).toContain('"suggestions"');
  });

  it('clamps list lengths and drops empties instead of failing on a long reply', async () => {
    const { generateBrief } = await import('./brief');
    runHarnessJson.mockResolvedValue({
      summary: '  Long. ',
      points: ['a', '', 'b', 'c', 'd', 'e', 'f', 'g'],
      open: [' x '],
      suggestions: ['s1', 's2', 's3', 's4', 's5'],
    });
    const brief = await generateBrief('note', note());
    expect(brief.summary).toBe('Long.');
    runHarnessJson.mockResolvedValue({ summary: 'Only a summary.' });
    const sparse = await generateBrief('task', task());
    expect(sparse.points).toEqual([]);
    expect(sparse.suggestions).toEqual([]);
    expect(brief.points).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(brief.open).toEqual(['x']);
    expect(brief.suggestions).toHaveLength(4);
  });

  it('dedupes concurrent generations for the same entity', async () => {
    const { generateBrief, isBriefGenerating } = await import('./brief');
    let release: (v: typeof CONTENT) => void = () => {};
    runHarnessJson.mockImplementation(
      () => new Promise((resolve) => { release = resolve; }),
    );
    const a = generateBrief('note', note());
    const b = generateBrief('note', note());
    expect(isBriefGenerating('note', 'note_1')).toBe(true);
    release(CONTENT);
    const [ra, rb] = await Promise.all([a, b]);
    expect(runHarnessJson).toHaveBeenCalledTimes(1);
    expect(ra).toBe(rb);
    expect(isBriefGenerating('note', 'note_1')).toBe(false);
  });

  it('propagates a harness failure and leaves no cache behind', async () => {
    const { generateBrief, getBriefState } = await import('./brief');
    runHarnessJson.mockRejectedValue(new Error('[entity-brief] claude one-shot failed: boom'));
    await expect(generateBrief('note', note())).rejects.toThrow('boom');
    expect(getBriefState('note', note()).status).toBe('missing');
  });
});

describe('ensureBrief', () => {
  it('returns inline and fresh states without a model call, generates otherwise', async () => {
    const { ensureBrief, generateBrief } = await import('./brief');
    runHarnessJson.mockResolvedValue(CONTENT);

    expect((await ensureBrief('note', note({ body: 'short' }))).status).toBe('inline');
    expect(runHarnessJson).not.toHaveBeenCalled();

    const generated = await ensureBrief('note', note());
    expect(generated.status).toBe('fresh');
    expect(runHarnessJson).toHaveBeenCalledTimes(1);

    // Fresh cache: no second call.
    await ensureBrief('note', note());
    expect(runHarnessJson).toHaveBeenCalledTimes(1);

    // Stale cache: regenerates.
    await generateBrief('note', note());
    await ensureBrief('note', note({ body: LONG_BODY + '\nedit' }));
    expect(runHarnessJson).toHaveBeenCalledTimes(3);
  });
});

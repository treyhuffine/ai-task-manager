import { describe, it, expect } from 'vitest';
import {
  buildItems,
  canBrowseReference,
  ENTITY_PREVIEW_LIMIT,
  entitySearchFor,
  NARROWED_LIMIT,
  narrowedQueryText,
  parseMentionQuery,
  parseReferenceDrillDown,
  pickReference,
  queryAllowsSpaces,
  toReferenceFileItems,
  rankReferences,
  rankPrs,
} from './ranking';
import type {
  FileMentionItem,
  ReferenceFolderMentionItem,
  MentionEntityResults,
  MentionItem,
  MoreMentionItem,
} from './types';
import type { PrMentionItem } from '../pr-menu/types';

/**
 * `@`-picker behavior for reference folders (docs/reference-folders-spec.md §8).
 */

function reference(
  overrides: Partial<ReferenceFolderMentionItem> = {},
): ReferenceFolderMentionItem {
  return {
    kind: 'reference',
    id: 'ref-1',
    alias: 'backend',
    absolutePath: '/code/api',
    exists: true,
    ...overrides,
  };
}

function file(path: string): FileMentionItem {
  return { kind: 'file', path, name: path.split('/').pop() ?? path };
}

function pr(overrides: Partial<PrMentionItem> = {}): PrMentionItem {
  return {
    number: 1,
    title: 'Add SEO footer',
    state: 'OPEN',
    isDraft: false,
    headRefName: 'codex/seo-footer',
    baseRefName: 'main',
    url: 'https://github.com/owner/repo/pull/1',
    updatedAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  };
}

/** What the server answered: rows in its order, and every match counted. */
function entities(
  taskTitles: string[],
  noteTitles: string[],
  totals?: Partial<MentionEntityResults['totals']>,
): MentionEntityResults {
  return {
    tasks: taskTitles.map((title, i) => ({ kind: 'task', id: `t${i}`, title, status: 'todo' })),
    notes: noteTitles.map((title, i) => ({ kind: 'note', id: `n${i}`, title })),
    totals: { tasks: totals?.tasks ?? taskTitles.length, notes: totals?.notes ?? noteTitles.length },
  };
}

const EMPTY = {
  files: [],
  entities: null,
  references: [],
  referenceFiles: null,
  prs: [],
  drillDown: null,
};

describe('parseReferenceDrillDown', () => {
  const refs = [reference(), reference({ id: 'ref-2', alias: 'vault', absolutePath: '/notes' })];

  it('matches a known alias followed by a slash', () => {
    const hit = parseReferenceDrillDown('backend/src/routes', refs);
    expect(hit?.reference.alias).toBe('backend');
    expect(hit?.rest).toBe('src/routes');
  });

  it('treats a bare `alias/` as an empty remainder, which lists the whole folder', () => {
    expect(parseReferenceDrillDown('backend/', refs)?.rest).toBe('');
  });

  it('ignores ordinary worktree paths so they still resolve normally', () => {
    expect(parseReferenceDrillDown('src/lib/foo.ts', refs)).toBeNull();
  });

  it('ignores an unknown alias', () => {
    expect(parseReferenceDrillDown('nope/thing.ts', refs)).toBeNull();
  });

  it('does not fire without a slash — that is still alias search', () => {
    expect(parseReferenceDrillDown('backend', refs)).toBeNull();
  });

  it('does not fire on a leading slash', () => {
    expect(parseReferenceDrillDown('/backend/x', refs)).toBeNull();
  });

  it('matches case-insensitively, since aliases are stored lowercase', () => {
    expect(parseReferenceDrillDown('BackEnd/x', refs)?.reference.alias).toBe('backend');
  });
});

describe('toReferenceFileItems', () => {
  it('stores the absolute path and a pretty alias-prefixed label', () => {
    const [item] = toReferenceFileItems(reference(), [file('src/routes.go')]);
    // Absolute is what the agent acts on — no prompt-side expansion needed.
    expect(item.path).toBe('/code/api/src/routes.go');
    expect(item.label).toBe('backend/src/routes.go');
    expect(item.name).toBe('routes.go');
    expect(item.referenceAlias).toBe('backend');
  });

  it('does not double the separator when the root has a trailing slash', () => {
    const [item] = toReferenceFileItems(reference({ absolutePath: '/code/api/' }), [
      file('go.mod'),
    ]);
    expect(item.path).toBe('/code/api/go.mod');
  });
});

describe('rankReferences', () => {
  const refs = [
    reference({ id: 'a', alias: 'backend' }),
    reference({ id: 'b', alias: 'back-office' }),
    reference({ id: 'c', alias: 'vault' }),
  ];

  it('returns everything for an empty query', () => {
    expect(rankReferences(refs, '')).toHaveLength(3);
  });

  it('prefers a prefix match and breaks ties on the shorter alias', () => {
    expect(rankReferences(refs, 'back').map((r) => r.alias)).toEqual(['backend', 'back-office']);
  });

  it('drops non-matches', () => {
    expect(rankReferences(refs, 'zzz')).toEqual([]);
  });
});

describe('buildItems', () => {
  const refs = [reference()];

  function kinds(items: MentionItem[]): string[] {
    return items.map((i) => i.kind);
  }

  it('offers reference folders between notes and files', () => {
    const items = buildItems({
      ...EMPTY,
      files: [file('src/app.ts')],
      references: refs,
      query: '',
    });
    const order = kinds(items);
    expect(order.indexOf('reference')).toBeGreaterThan(order.indexOf('scratchpad'));
    expect(order.indexOf('reference')).toBeLessThan(order.indexOf('file'));
  });

  it('matches a reference by alias while typing', () => {
    const items = buildItems({ ...EMPTY, references: refs, query: 'backe' });
    expect(items.filter((i) => i.kind === 'reference')).toHaveLength(1);
  });

  it('leads with the reference’s own files once drilled in', () => {
    const drillDown = parseReferenceDrillDown('backend/routes', refs)!;
    const items = buildItems({
      ...EMPTY,
      files: [file('src/routes.ts')],
      references: refs,
      referenceFiles: toReferenceFileItems(refs[0], [file('src/routes.go')]),
      drillDown,
      query: 'backend/routes',
    });
    const first = items[0] as FileMentionItem;
    expect(first.referenceAlias).toBe('backend');
    expect(first.path).toBe('/code/api/src/routes.go');
  });

  it('still offers worktree files inside a drill-down, so a name clash hides nothing', () => {
    // An alias that shares a name with a real worktree folder must not make
    // that folder unreachable.
    const clashing = [reference({ alias: 'docs', absolutePath: '/external/docs' })];
    const drillDown = parseReferenceDrillDown('docs/readme', clashing)!;
    const items = buildItems({
      ...EMPTY,
      files: [file('docs/readme.md')],
      references: clashing,
      referenceFiles: toReferenceFileItems(clashing[0], [file('readme.md')]),
      drillDown,
      query: 'docs/readme',
    });
    const paths = (items as FileMentionItem[]).map((i) => i.path);
    expect(paths).toContain('/external/docs/readme.md');
    expect(paths).toContain('docs/readme.md');
  });

  it('drops the entity sections inside a drill-down — the user said where they are looking', () => {
    const drillDown = parseReferenceDrillDown('backend/', refs)!;
    const items = buildItems({
      ...EMPTY,
      references: refs,
      referenceFiles: toReferenceFileItems(refs[0], [file('go.mod')]),
      drillDown,
      query: 'backend/',
    });
    expect(kinds(items)).not.toContain('scratchpad');
    expect(kinds(items)).not.toContain('reference');
  });

  it('degrades to worktree matches when the reference tree failed to load', () => {
    const drillDown = parseReferenceDrillDown('backend/app', refs)!;
    const items = buildItems({
      ...EMPTY,
      files: [file('src/app.ts')],
      references: refs,
      referenceFiles: null,
      drillDown,
      query: 'backend/app',
    });
    // Not empty, and definitely not throwing mid-keystroke.
    expect(items.length).toBeGreaterThanOrEqual(0);
    expect(kinds(items).every((k) => k === 'file' || k === 'dir')).toBe(true);
  });

  it('scores drill-down files on the relative path, not the absolute one', () => {
    // A user whose home dir is /Users/api should not get every file in the
    // reference scoring a hit on "api".
    const homey = [reference({ alias: 'backend', absolutePath: '/Users/api/code' })];
    const drillDown = parseReferenceDrillDown('backend/handlers', homey)!;
    const items = buildItems({
      ...EMPTY,
      references: homey,
      referenceFiles: toReferenceFileItems(homey[0], [
        file('internal/handlers.go'),
        file('cmd/main.go'),
      ]),
      drillDown,
      query: 'backend/handlers',
    });
    expect(items).toHaveLength(1);
    expect((items[0] as FileMentionItem).label).toBe('backend/internal/handlers.go');
  });

  it('leaves the non-reference picker exactly as it was', () => {
    const items = buildItems({
      ...EMPTY,
      files: [file('src/app.ts')],
      entities: entities(['Ship it'], ['Ideas']),
      query: '',
    });
    expect(kinds(items)).toEqual(['scratchpad', 'task', 'note', 'file']);
  });

  it('switches to PR-only results the moment the query opens with `#`', () => {
    // Files/tasks/notes are all present, but `@#` must return PRs alone.
    const items = buildItems({
      ...EMPTY,
      files: [file('src/app.ts')],
      entities: entities(['Ship it'], ['Ideas']),
      prs: [pr({ number: 193, title: 'Add SEO footer' })],
      query: '#',
    });
    expect(kinds(items)).toEqual(['pr']);
    expect((items[0] as { number: number }).number).toBe(193);
  });

  it('keeps PRs out of the default `@` list', () => {
    const items = buildItems({
      ...EMPTY,
      files: [file('src/app.ts')],
      prs: [pr({ number: 193 })],
      query: '',
    });
    expect(kinds(items)).not.toContain('pr');
  });

  it('filters PRs by the query after the `#`', () => {
    const items = buildItems({
      ...EMPTY,
      prs: [pr({ number: 12 }), pr({ number: 193 }), pr({ number: 7 })],
      query: '#19',
    });
    expect((items as { number: number }[]).map((i) => i.number)).toEqual([193]);
  });
});

describe('rankPrs', () => {
  const prs = [
    pr({ number: 22, title: 'Fix login', headRefName: 'fix/login', updatedAt: '2026-07-01T00:00:00.000Z' }),
    pr({ number: 221, title: 'Add settings', headRefName: 'feat/settings', updatedAt: '2026-07-03T00:00:00.000Z' }),
    pr({ number: 322, title: 'Refactor auth', headRefName: 'chore/auth', updatedAt: '2026-07-02T00:00:00.000Z' }),
  ];

  it('returns everything for an empty query, tagged as `pr`', () => {
    const out = rankPrs(prs, '');
    expect(out).toHaveLength(3);
    expect(out.every((p) => p.kind === 'pr')).toBe(true);
  });

  it('ranks a numeric query exact → number-prefix → number-substring', () => {
    // `22` should surface #22 first, then #221 (prefix), then #322 (substring).
    expect(rankPrs(prs, '22').map((p) => p.number)).toEqual([22, 221, 322]);
  });

  it('matches a text query on title, then head branch', () => {
    expect(rankPrs(prs, 'settings').map((p) => p.number)).toEqual([221]);
    expect(rankPrs(prs, 'auth').map((p) => p.number)).toEqual([322]);
  });

  it('drops PRs that match neither number, title, nor branch', () => {
    expect(rankPrs(prs, 'zzz')).toEqual([]);
  });
});

describe('a linked folder whose files are on another device', () => {
  const onMacBook: ReferenceFolderMentionItem = {
    kind: 'reference',
    id: 'r1',
    alias: 'beamd-cli',
    absolutePath: '/Users/trey/code/beamd',
    exists: true,
    browsable: false,
  };

  it('is mentioned at its path there, rather than browsed from here', () => {
    expect(canBrowseReference(onMacBook)).toBe(false);
    expect(pickReference(onMacBook)).toEqual({
      kind: 'chip',
      chip: { kind: 'dir', path: '/Users/trey/code/beamd', name: 'beamd-cli', label: 'beamd-cli', referenceAlias: 'beamd-cli' },
    });
  });

  it('drills in as before when it is here', () => {
    const here = { ...onMacBook, absolutePath: '/Users/agent/code/beamd', browsable: true };
    expect(canBrowseReference(here)).toBe(true);
    expect(pickReference(here)).toEqual({ kind: 'drill', text: '@beamd-cli/' });
    expect(canBrowseReference({ ...here, exists: false })).toBe(false);
  });
});

describe('parseMentionQuery', () => {
  it('reads the filter from how the query opens, case aside', () => {
    expect(parseMentionQuery('#193')).toEqual({ filter: 'pr', text: '193' });
    expect(parseMentionQuery('task:deploy')).toEqual({ filter: 'task', text: 'deploy' });
    expect(parseMentionQuery('Tasks: deploy keys ')).toEqual({ filter: 'task', text: 'deploy keys' });
    expect(parseMentionQuery('note:')).toEqual({ filter: 'note', text: '' });
    expect(parseMentionQuery('NOTES:ideas')).toEqual({ filter: 'note', text: 'ideas' });
    expect(parseMentionQuery('file:page.tsx')).toEqual({ filter: 'file', text: 'page.tsx' });
  });

  it('leaves everything else as a mixed search', () => {
    expect(parseMentionQuery('deploy')).toEqual({ filter: null, text: 'deploy' });
    expect(parseMentionQuery('taskboard')).toEqual({ filter: null, text: 'taskboard' });
    expect(parseMentionQuery('src/task:x')).toEqual({ filter: null, text: 'src/task:x' });
  });

  it('lets only the task and note filters run across spaces', () => {
    expect(queryAllowsSpaces('task:deploy keys')).toBe(true);
    expect(queryAllowsSpaces('note:launch plan')).toBe(true);
    expect(queryAllowsSpaces('file:src')).toBe(false);
    expect(queryAllowsSpaces('#12')).toBe(false);
    expect(queryAllowsSpaces('deploy keys')).toBe(false);
  });

  it('writes the narrowed query a "more" row turns into', () => {
    expect(narrowedQueryText('task', 'dep')).toBe('@task:dep');
    expect(narrowedQueryText('note', '')).toBe('@note:');
  });
});

describe('entitySearchFor', () => {
  it('asks for a short page of each kind in the mixed list', () => {
    expect(entitySearchFor(parseMentionQuery('dep'), false)).toEqual({ q: 'dep', limit: ENTITY_PREVIEW_LIMIT });
  });

  it('asks for a long page of one kind once narrowed', () => {
    expect(entitySearchFor(parseMentionQuery('task:deploy keys'), false)).toEqual({
      q: 'deploy keys',
      kind: 'task',
      limit: NARROWED_LIMIT,
    });
    expect(entitySearchFor(parseMentionQuery('note:'), false)).toEqual({ q: '', kind: 'note', limit: NARROWED_LIMIT });
  });

  it('asks for nothing where no tasks or notes show', () => {
    expect(entitySearchFor(parseMentionQuery('#12'), false)).toBeNull();
    expect(entitySearchFor(parseMentionQuery('file:app'), false)).toBeNull();
    expect(entitySearchFor(parseMentionQuery('backend/'), true)).toBeNull();
  });
});

describe('buildItems with server results', () => {
  const titles = (items: MentionItem[]) =>
    items.map((i) => (i.kind === 'task' || i.kind === 'note' ? i.title : i.kind));

  it('keeps the server order rather than re-ranking', () => {
    const items = buildItems({ ...EMPTY, entities: entities(['Fix deploy', 'Deploy'], []), query: 'deploy' });
    expect(titles(items)).toEqual(['Fix deploy', 'Deploy']);
  });

  it('ends a kind with an "All N" row when more matched, which narrows to it', () => {
    const items = buildItems({
      ...EMPTY,
      entities: entities(['A', 'B'], ['C'], { tasks: 40, notes: 1 }),
      query: 'x',
    });
    expect(kinds(items)).toEqual(['task', 'task', 'more', 'note']);
    expect(items[2]).toEqual({ kind: 'more', of: 'task', total: 40, shown: 2, query: 'x', narrowed: false });
  });

  it('narrows to tasks alone for `task:`, with a caption when the page is capped', () => {
    const items = buildItems({
      ...EMPTY,
      files: [file('src/deploy.ts')],
      entities: entities(['Deploy keys'], [], { tasks: 120 }),
      query: 'task:deploy',
    });
    expect(kinds(items)).toEqual(['task', 'more']);
    expect((items[1] as MoreMentionItem).narrowed).toBe(true);
  });

  it('narrows to notes alone for `note:`', () => {
    const items = buildItems({ ...EMPTY, entities: entities([], ['Launch plan']), query: 'note:launch' });
    expect(kinds(items)).toEqual(['note']);
  });

  it('narrows to files alone for `file:`, with room for more of them', () => {
    const many = Array.from({ length: 80 }, (_, i) => file(`src/page${i}.tsx`));
    const items = buildItems({ ...EMPTY, files: many, entities: entities(['Page'], []), query: 'file:page' });
    expect(kinds(items).every((k) => k === 'file')).toBe(true);
    expect(items).toHaveLength(NARROWED_LIMIT);
  });

  it('puts files first for a query that looks like a path', () => {
    const items = buildItems({
      ...EMPTY,
      files: [file('src/app/page.tsx')],
      entities: entities(['Page layout'], []),
      query: 'page.tsx',
    });
    expect(kinds(items)).toEqual(['file', 'task']);
  });

  it('still lists files when the search failed', () => {
    const items = buildItems({ ...EMPTY, files: [file('src/app.ts')], entities: null, query: 'app' });
    expect(kinds(items)).toEqual(['file']);
  });

  function kinds(items: MentionItem[]): string[] {
    return items.map((i) => i.kind);
  }
});

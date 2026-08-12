import { describe, it, expect } from 'vitest';
import { rankCommands, highlightSegments, TIER } from './ranking';
import type { SlashCommand } from './types';

/**
 * Ordering rules for the `/`-picker. The menu used to be an unsorted
 * `includes()` filter over name OR description, so a description hit could
 * outrank an exact name hit. Everything here guards against that returning.
 */

function cmd(name: string, description?: string, frecency?: number): SlashCommand {
  return {
    id: `id-${name}`,
    name,
    description,
    source: 'installed-user',
    userInvocable: true,
    available: true,
    execution: { kind: 'provider-slash', provider: 'claude', commandText: `/${name}` },
    ...(frecency === undefined ? {} : { frecency }),
  };
}

const names = (matches: { command: SlashCommand }[]) => matches.map((m) => m.command.name);

describe('rankCommands — name beats description', () => {
  // The reported bug, verbatim: typing `/impl` buried `implementing-specs`
  // under every skill whose description happened to say "implement".
  const REAL_WORLD = [
    cmd('execute-spec', 'Using the workflow MCP, implement the spec in folder'),
    cmd('plan-eng-review', 'Lock in the execution plan before implementation'),
    cmd('plan-design-review', 'Designer plan review before implementation'),
    cmd('implementing-specs', 'Use when the user wants to build against a written specification'),
    cmd('init-spec-prd', 'Initialize a new spec using the spec workflow MCP'),
  ];

  it('puts the name-prefix match first for `impl`', () => {
    expect(names(rankCommands(REAL_WORLD, 'impl'))[0]).toBe('implementing-specs');
  });

  it('still returns the description matches, just below', () => {
    const ranked = names(rankCommands(REAL_WORLD, 'impl'));
    expect(ranked).toContain('execute-spec');
    expect(ranked).toContain('plan-eng-review');
    expect(ranked.indexOf('implementing-specs')).toBeLessThan(ranked.indexOf('execute-spec'));
  });

  it('drops commands that match nothing', () => {
    // `init-spec-prd` has no `m` in its name and no "impl" in its description.
    expect(names(rankCommands(REAL_WORLD, 'impl'))).not.toContain('init-spec-prd');
    expect(names(rankCommands(REAL_WORLD, 'zzz'))).toEqual([]);
  });

  it('does not truncate — a skill the user is reaching for is never hidden', () => {
    // Deliberately larger than any list a human wants to scroll. Hiding a
    // match reads as broken in a way a long list never does, so the ranker
    // has no cap and this pins that.
    const many = Array.from({ length: 60 }, (_, i) => cmd(`review-${i}`, 'review something'));
    expect(rankCommands(many, 'review')).toHaveLength(60);
  });
});

describe('rankCommands — tiers', () => {
  it('exact name beats prefix, so `/qa` is not shadowed by `/qa-only`', () => {
    const ranked = rankCommands([cmd('qa-only'), cmd('qa')], 'qa');
    expect(names(ranked)).toEqual(['qa', 'qa-only']);
    expect(ranked[0]!.tier).toBe(TIER.exactName);
    expect(ranked[1]!.tier).toBe(TIER.namePrefix);
  });

  it('matches a later segment: `design` finds `plan-design-review`', () => {
    const ranked = rankCommands([cmd('ship'), cmd('plan-design-review')], 'design');
    expect(names(ranked)).toEqual(['plan-design-review']);
    expect(ranked[0]!.tier).toBe(TIER.segmentPrefix);
  });

  it('prefers a whole-name prefix over a later-segment prefix', () => {
    const ranked = rankCommands([cmd('plan-design-review'), cmd('design-review')], 'design');
    expect(names(ranked)).toEqual(['design-review', 'plan-design-review']);
  });

  it('matches an acronym: `pdr` finds `plan-design-review`', () => {
    const ranked = rankCommands([cmd('plan-design-review'), cmd('ship')], 'pdr');
    expect(names(ranked)).toEqual(['plan-design-review']);
    expect(ranked[0]!.tier).toBe(TIER.acronym);
  });

  it('prefers an acronym covering every segment over one covering a prefix', () => {
    const ranked = rankCommands([cmd('plan-ceo-review-extra'), cmd('plan-ceo-review')], 'pcr');
    expect(names(ranked)).toEqual(['plan-ceo-review', 'plan-ceo-review-extra']);
  });

  it('ignores single-character acronyms, which would match half the list', () => {
    // `p` is a name prefix of `plan-eng-review` and nothing else here.
    expect(names(rankCommands([cmd('plan-eng-review'), cmd('design-review')], 'p'))).toEqual([
      'plan-eng-review',
    ]);
  });

  it('falls back to a subsequence match on the name', () => {
    const ranked = rankCommands([cmd('geo-citability'), cmd('ship')], 'gcit');
    expect(names(ranked)).toEqual(['geo-citability']);
    expect(ranked[0]!.tier).toBe(TIER.nameFuzzy);
  });

  it('prefers a description word-start over a mid-word hit', () => {
    const ranked = rankCommands(
      [cmd('alpha', 'a total reimplementation of the thing'), cmd('beta', 'implement the thing')],
      'implement',
    );
    expect(names(ranked)).toEqual(['beta', 'alpha']);
    expect(ranked[0]!.tier).toBe(TIER.descriptionWord);
    expect(ranked[1]!.tier).toBe(TIER.descriptionSubstring);
  });

  it('is case insensitive on both sides', () => {
    expect(names(rankCommands([cmd('Ship', 'Deploy It')], 'SH'))).toEqual(['Ship']);
    expect(names(rankCommands([cmd('Ship', 'Deploy It')], 'deploy'))).toEqual(['Ship']);
  });
});

describe('rankCommands — frecency', () => {
  it('breaks ties within a tier', () => {
    const ranked = rankCommands(
      [cmd('geo-citability'), cmd('geo-content', undefined, 12), cmd('geo-compare')],
      'geo-c',
    );
    expect(names(ranked)[0]).toBe('geo-content');
  });

  it('NEVER promotes across a tier — the invariant the score math exists for', () => {
    // `review` used enormously; `review-plan` never. A description-tier hit on
    // the heavily-used command must still lose to a name-tier hit.
    const ranked = rankCommands(
      [
        cmd('unrelated-name', 'all about review', 100_000),
        cmd('review-plan', 'nothing relevant here'),
      ],
      'review',
    );
    expect(names(ranked)).toEqual(['review-plan', 'unrelated-name']);
  });

  it('holds the invariant across every adjacent tier pair', () => {
    // Exact-name (tier 0) with zero uses vs each lower tier at max frecency.
    const lower = [
      { command: cmd('review-plan'), query: 'review' }, // namePrefix
      { command: cmd('plan-review'), query: 'review' }, // segmentPrefix
      { command: cmd('really-early-view'), query: 'rev' }, // acronym
      { command: cmd('rxexvxixexw'), query: 'review' }, // nameFuzzy
      { command: cmd('other', 'review it'), query: 'review' }, // descriptionWord
      { command: cmd('other2', 'prereview it'), query: 'review' }, // descriptionSubstring
    ];
    for (const { command, query } of lower) {
      const hot = { ...command, frecency: 1_000_000 };
      const ranked = rankCommands([hot, cmd('review')], query);
      expect(names(ranked)[0]).toBe('review');
    }
  });

  it('orders the empty query by usage, then alphabetically', () => {
    const ranked = rankCommands(
      [cmd('ship', undefined, 3), cmd('alpha'), cmd('qa', undefined, 9), cmd('beta')],
      '',
    );
    expect(names(ranked)).toEqual(['qa', 'ship', 'alpha', 'beta']);
  });

  it('returns every command for an empty query', () => {
    const all = [cmd('a'), cmd('b'), cmd('c')];
    expect(rankCommands(all, '')).toHaveLength(3);
  });

  it('ranks fine with no usage data at all (fresh install)', () => {
    expect(names(rankCommands([cmd('execute-spec', 'implement it'), cmd('implementing-specs')], 'impl'))).toEqual([
      'implementing-specs',
      'execute-spec',
    ]);
  });
});

describe('rankCommands — match positions', () => {
  it('reports the matched name characters for highlighting', () => {
    const [hit] = rankCommands([cmd('implementing-specs')], 'impl');
    expect(hit!.nameMatches).toEqual([0, 1, 2, 3]);
    expect(hit!.descriptionMatches).toEqual([]);
  });

  it('reports description positions when the name did not match', () => {
    const [hit] = rankCommands([cmd('execute-spec', 'now implement it')], 'implement');
    expect(hit!.nameMatches).toEqual([]);
    expect(hit!.descriptionMatches).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('marks segment starts for an acronym match', () => {
    const [hit] = rankCommands([cmd('plan-design-review')], 'pdr');
    expect(hit!.nameMatches).toEqual([0, 5, 12]);
  });

  it('tightens a fuzzy run to the rightmost positions', () => {
    // Greedy-forward alone would match `abc` here as 0,2,3 rather than 1,2,3.
    const [hit] = rankCommands([cmd('aabc')], 'abc');
    expect(hit!.nameMatches).toEqual([1, 2, 3]);
  });

  it('has no positions for an empty query', () => {
    const [hit] = rankCommands([cmd('ship')], '');
    expect(hit!.nameMatches).toEqual([]);
    expect(hit!.tier).toBeNull();
  });
});

describe('highlightSegments', () => {
  it('splits into matched and unmatched runs', () => {
    expect(highlightSegments('implementing', [0, 1, 2, 3])).toEqual([
      { text: 'impl', match: true },
      { text: 'ementing', match: false },
    ]);
  });

  it('handles non-contiguous matches', () => {
    expect(highlightSegments('geo-citability', [0, 4, 5, 6])).toEqual([
      { text: 'g', match: true },
      { text: 'eo-', match: false },
      { text: 'cit', match: true },
      { text: 'ability', match: false },
    ]);
  });

  it('returns one unmatched run when nothing matched', () => {
    expect(highlightSegments('ship', [])).toEqual([{ text: 'ship', match: false }]);
  });

  it('handles a match running to the end of the string', () => {
    expect(highlightSegments('qa', [0, 1])).toEqual([{ text: 'qa', match: true }]);
  });
});

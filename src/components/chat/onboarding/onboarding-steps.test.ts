import { describe, expect, it } from 'vitest';
import type { ExternalAgentDiscovery } from '@/lib/import/types';
import { importableHistory, preselectedProjects, recentProjects } from './onboarding-import';
import { AREA_PRESETS, areaOptions } from './onboarding-areas';

let n = 0;
function session(source: 'claude' | 'codex' | 'opencode', updatedAt: string, opts: { imported?: boolean; importable?: boolean } = {}) {
  n += 1;
  return {
    key: `${source}:${n}`,
    source,
    label: `Chat ${n}`,
    updatedAt,
    imported: !!opts.imported,
    ...(opts.importable === undefined ? {} : { importable: opts.importable }),
  };
}

function project(name: string, sessions: ReturnType<typeof session>[], pathExists = true) {
  return { id: `/code/${name}`, name, cwd: `/code/${name}`, pathExists, sessions };
}

const NOW = Date.parse('2026-10-01T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const discovery = {
  projects: [
    project('ri', [session('claude', daysAgo(1)), session('codex', daysAgo(2)), session('claude', daysAgo(40), { imported: true })]),
    project('blog', [session('claude', daysAgo(5))]),
    project('old-thing', [session('codex', daysAgo(90))]),
    project('gone', [session('claude', daysAgo(0))], false),
    project('done', [session('claude', daysAgo(3), { imported: true })]),
    project('exp', [session('claude', daysAgo(6), { importable: false })]),
    project('site', [session('claude', daysAgo(9))]),
  ],
  sources: { claude: { imported: 2 }, codex: { imported: 0 }, opencode: { imported: 0 } },
} as unknown as ExternalAgentDiscovery;

describe('importableHistory', () => {
  it('counts what is not in Ri yet, by project and by tool, most first', () => {
    expect(importableHistory(discovery)).toEqual({ projects: 5, chats: 6, sources: ['Claude Code', 'Codex'] });
  });
});

describe('recentProjects', () => {
  it('offers projects still on disk with chats to bring in, newest first', () => {
    const recent = recentProjects(discovery);
    expect(recent.map((p) => p.name)).toEqual(['ri', 'blog', 'site', 'old-thing']);
    expect(recent[0]).toMatchObject({ sources: ['Claude Code', 'Codex'], titles: ['Chat 1', 'Chat 2'] });
    expect(recent[0]!.sessionKeys).toHaveLength(2);
  });

  it('stops at the limit', () => {
    expect(recentProjects(discovery, 2).map((p) => p.name)).toEqual(['ri', 'blog']);
  });
});

describe('preselectedProjects', () => {
  it('ticks the ones worked in within two weeks, three at most', () => {
    expect(preselectedProjects(recentProjects(discovery), NOW)).toEqual(['/code/ri', '/code/blog', '/code/site']);
  });

  it('ticks nothing when nothing is recent', () => {
    expect(preselectedProjects(recentProjects(discovery).slice(3), NOW)).toEqual([]);
  });
});

describe('areaOptions', () => {
  it('offers the presets until there are suggestions', () => {
    expect(areaOptions([])).toEqual(AREA_PRESETS);
  });

  it('puts suggestions first and keeps only the presets they leave out', () => {
    expect(areaOptions([{ name: 'Ri', emoji: '🌀' }, { name: 'personal', emoji: '🏡' }]).map((a) => a.name)).toEqual([
      'Ri',
      'personal',
      'Work',
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import type { ExternalAgentDiscovery } from '@/lib/import/types';
import { importableHistory } from './onboarding-import';
import { AREA_PRESETS, areaOptions } from './onboarding-areas';

function session(source: 'claude' | 'codex' | 'opencode', imported = false, importable?: boolean) {
  return { source, imported, ...(importable === undefined ? {} : { importable }) };
}

describe('importableHistory', () => {
  it('counts what is not in Ri yet, by project and by tool, most first', () => {
    const discovery = {
      projects: [
        { sessions: [session('claude'), session('claude'), session('codex')] },
        { sessions: [session('claude', true)] },
        { sessions: [session('codex', false, false), session('claude')] },
      ],
      sources: { claude: { imported: 1 }, codex: { imported: 0 }, opencode: { imported: 0 } },
    } as unknown as ExternalAgentDiscovery;
    expect(importableHistory(discovery)).toEqual({ projects: 2, chats: 4, sources: ['Claude Code', 'Codex'], imported: 1 });
  });

  it('finds nothing in a history that is all brought in', () => {
    const discovery = {
      projects: [{ sessions: [session('claude', true)] }],
      sources: { claude: { imported: 1 }, codex: { imported: 0 }, opencode: { imported: 0 } },
    } as unknown as ExternalAgentDiscovery;
    expect(importableHistory(discovery)).toMatchObject({ projects: 0, chats: 0 });
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

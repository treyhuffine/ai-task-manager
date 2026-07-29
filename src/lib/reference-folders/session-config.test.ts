import { describe, it, expect } from 'vitest';
import {
  buildReferenceFolderSessionConfig,
  referenceFolderProviderWiring,
  editDenyRule,
} from '@/lib/reference-folders/session-config';
import type { ResolvedReferenceFolder } from '@/db/types';

function ref(overrides: Partial<ResolvedReferenceFolder> = {}): ResolvedReferenceFolder {
  return {
    id: 'ref-1',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    workspaceId: 'ws-1',
    alias: 'backend',
    path: '/code/api',
    targetWorkspaceId: null,
    description: null,
    position: 0,
    status: 'active',
    archivedAt: null,
    absolutePath: '/code/api',
    exists: true,
    git: null,
    global: false,
    ...overrides,
  };
}

describe('editDenyRule', () => {
  it('uses Claude Code’s double-slash form for an absolute path', () => {
    // Verified against Claude Code 2.1.220: this form blocks a Write into the
    // folder even under --dangerously-skip-permissions. `Write(<path>)` rules
    // are silently ignored by file permission checks, so we never emit them.
    expect(editDenyRule('/code/api')).toBe('Edit(//code/api/**)');
  });
});

describe('buildReferenceFolderSessionConfig', () => {
  it('produces nothing for an empty list', () => {
    expect(buildReferenceFolderSessionConfig([])).toEqual({
      instructions: '',
      addDirs: [],
      disallowedTools: [],
    });
  });

  it('pairs every folder with an add-dir and a deny rule', () => {
    const config = buildReferenceFolderSessionConfig([
      ref({ id: 'a', alias: 'backend', absolutePath: '/code/api' }),
      ref({ id: 'b', alias: 'vault', absolutePath: '/notes' }),
    ]);
    expect(config.addDirs).toEqual(['/code/api', '/notes']);
    expect(config.disallowedTools).toEqual(['Edit(//code/api/**)', 'Edit(//notes/**)']);
    expect(config.instructions).toContain('backend');
    expect(config.instructions).toContain('vault');
  });

  it('dedupes two aliases pointing at the same folder', () => {
    // Allowed by design — blocking it is more annoying than the duplication —
    // but the CLI should not be handed the same path twice.
    const config = buildReferenceFolderSessionConfig([
      ref({ id: 'a', alias: 'api', absolutePath: '/code/api' }),
      ref({ id: 'b', alias: 'backend', absolutePath: '/code/api' }),
    ]);
    expect(config.addDirs).toEqual(['/code/api']);
    expect(config.disallowedTools).toEqual(['Edit(//code/api/**)']);
    // Both aliases still get announced, since the user typed both.
    expect(config.instructions).toContain('api');
    expect(config.instructions).toContain('backend');
  });
});

describe('referenceFolderProviderWiring', () => {
  const config = buildReferenceFolderSessionConfig([
    ref({ id: 'a', alias: 'backend', absolutePath: '/code/api' }),
    ref({ id: 'b', alias: 'vault', absolutePath: '/notes' }),
  ]);

  it('gives claude the full treatment: instructions, add-dir, deny rules', () => {
    const wiring = referenceFolderProviderWiring(config, 'claude');
    expect(wiring.delivery).toBe('full');
    expect(wiring.deliversInstructions).toBe(true);
    // Verified against Claude Code 2.1.220: repeated --add-dir accumulates
    // rather than overwriting, so these coexist with agentex's own skills dir.
    expect(wiring.extraArgs).toEqual([
      '--add-dir',
      '/code/api',
      '--add-dir',
      '/notes',
    ]);
    expect(wiring.disallowedTools).toEqual(['Edit(//code/api/**)', 'Edit(//notes/**)']);
  });

  it('tells codex about the folders but cannot fence them off', () => {
    const wiring = referenceFolderProviderWiring(config, 'codex');
    expect(wiring.delivery).toBe('prompt-only');
    expect(wiring.deliversInstructions).toBe(true);
    expect(wiring.extraArgs).toEqual([]);
    expect(wiring.disallowedTools).toEqual([]);
  });

  it('reports cursor and opencode as unsupported rather than pretending', () => {
    // Regression guard. agentex 0.0.34 reads `instructionsFile` in
    // `session.ts` only for claude/codex/pi — for cursor and opencode it lives
    // in `execute.ts`, which Flow never uses. Marking these `prompt-only`
    // would log a reassuring warning while the agent learned nothing.
    for (const provider of ['cursor', 'opencode', 'gemini', 'copilot', 'acp']) {
      const wiring = referenceFolderProviderWiring(config, provider);
      expect(wiring.delivery).toBe('unsupported');
      expect(wiring.deliversInstructions).toBe(false);
      expect(wiring.extraArgs).toEqual([]);
      expect(wiring.disallowedTools).toEqual([]);
    }
  });

  it('is inert when there are no references, on every provider', () => {
    const empty = buildReferenceFolderSessionConfig([]);
    for (const provider of ['claude', 'codex', 'opencode']) {
      const wiring = referenceFolderProviderWiring(empty, provider);
      expect(wiring.deliversInstructions).toBe(false);
      expect(wiring.extraArgs).toEqual([]);
      expect(wiring.disallowedTools).toEqual([]);
    }
  });
});

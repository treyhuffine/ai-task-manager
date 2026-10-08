import { describe, it, expect } from 'vitest';
import {
  buildReferenceFolderSessionConfig,
  codexWritableRootsArgs,
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
    readOnly: null,
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

describe('codexWritableRootsArgs', () => {
  it('is a root -c override with a TOML array of the paths', () => {
    // Verified on codex-cli 0.160: `codex app-server --strict-config` accepts
    // this key, and rejects a value that isn't a list.
    expect(codexWritableRootsArgs(['/code/api', '/notes/my vault'])).toEqual([
      '-c',
      'sandbox_workspace_write.writable_roots=["/code/api","/notes/my vault"]',
    ]);
  });

  it('is nothing when no folder is editable', () => {
    expect(codexWritableRootsArgs([])).toEqual([]);
  });
});

describe('buildReferenceFolderSessionConfig', () => {
  it('produces nothing for an empty list', () => {
    expect(buildReferenceFolderSessionConfig([])).toEqual({
      instructions: '',
      addDirs: [],
      readOnlyDirs: [],
      writableDirs: [],
      disallowedTools: [],
    });
  });

  it('exposes every folder, and guards only the read-only ones', () => {
    const config = buildReferenceFolderSessionConfig([
      ref({ id: 'a', alias: 'backend', absolutePath: '/code/api' }),
      ref({ id: 'b', alias: 'vault', absolutePath: '/notes', readOnly: true }),
      ref({ id: 'c', alias: 'docs', absolutePath: '/docs', readOnly: false }),
    ]);
    expect(config.addDirs).toEqual(['/code/api', '/notes', '/docs']);
    expect(config.readOnlyDirs).toEqual(['/notes']);
    expect(config.writableDirs).toEqual(['/code/api', '/docs']);
    expect(config.disallowedTools).toEqual(['Edit(//notes/**)']);
    expect(config.instructions).toContain('backend');
    expect(config.instructions).toContain('vault');
    expect(config.instructions).toContain('docs');
  });

  it('guards nothing when no folder is read only, the default', () => {
    const config = buildReferenceFolderSessionConfig([ref({ absolutePath: '/code/api' })]);
    expect(config.addDirs).toEqual(['/code/api']);
    expect(config.writableDirs).toEqual(['/code/api']);
    expect(config.disallowedTools).toEqual([]);
  });

  it('dedupes two aliases pointing at the same folder', () => {
    // Allowed by design — blocking it is more annoying than the duplication —
    // but the CLI should not be handed the same path twice.
    const config = buildReferenceFolderSessionConfig([
      ref({ id: 'a', alias: 'api', absolutePath: '/code/api', readOnly: true }),
      ref({ id: 'b', alias: 'backend', absolutePath: '/code/api', readOnly: true }),
    ]);
    expect(config.addDirs).toEqual(['/code/api']);
    expect(config.disallowedTools).toEqual(['Edit(//code/api/**)']);
    // Both aliases still get announced, since the user typed both.
    expect(config.instructions).toContain('api');
    expect(config.instructions).toContain('backend');
  });

  it('keeps a folder read only when one of its aliases is', () => {
    const config = buildReferenceFolderSessionConfig([
      ref({ id: 'a', alias: 'api', absolutePath: '/code/api' }),
      ref({ id: 'b', alias: 'backend', absolutePath: '/code/api', readOnly: true }),
    ]);
    expect(config.readOnlyDirs).toEqual(['/code/api']);
    expect(config.writableDirs).toEqual([]);
    expect(config.disallowedTools).toEqual(['Edit(//code/api/**)']);
  });
});

describe('referenceFolderProviderWiring', () => {
  const config = buildReferenceFolderSessionConfig([
    ref({ id: 'a', alias: 'backend', absolutePath: '/code/api' }),
    ref({ id: 'b', alias: 'vault', absolutePath: '/notes', readOnly: true }),
  ]);

  it('gives claude the full treatment: instructions, add-dir, deny rules on read-only folders', () => {
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
    expect(wiring.disallowedTools).toEqual(['Edit(//notes/**)']);
  });

  it('tells codex about the folders, makes the editable ones writable, and cannot fence off the rest', () => {
    const wiring = referenceFolderProviderWiring(config, 'codex');
    expect(wiring.delivery).toBe('prompt-only');
    expect(wiring.deliversInstructions).toBe(true);
    expect(wiring.extraArgs).toEqual(['-c', 'sandbox_workspace_write.writable_roots=["/code/api"]']);
    expect(wiring.disallowedTools).toEqual([]);
  });

  it('has nothing to fence off on codex when every folder is editable', () => {
    const editable = buildReferenceFolderSessionConfig([ref({ absolutePath: '/code/api' })]);
    const wiring = referenceFolderProviderWiring(editable, 'codex');
    expect(wiring.delivery).toBe('full');
    expect(wiring.extraArgs).toEqual(['-c', 'sandbox_workspace_write.writable_roots=["/code/api"]']);
  });

  it('gives codex no writable roots when every folder is read only', () => {
    const readOnly = buildReferenceFolderSessionConfig([ref({ absolutePath: '/notes', readOnly: true })]);
    expect(referenceFolderProviderWiring(readOnly, 'codex').extraArgs).toEqual([]);
  });

  it('tells antigravity about the folders but cannot fence them off', () => {
    // agentex 0.0.39 reads `instructionsFile` in the antigravity session and
    // sends it ahead of the first message. `agy` takes no tool-filter flags.
    const wiring = referenceFolderProviderWiring(config, 'antigravity');
    expect(wiring).toEqual({ delivery: 'prompt-only', deliversInstructions: true, extraArgs: [], disallowedTools: [] });
  });

  it('reports cursor and opencode as unsupported rather than pretending', () => {
    // Regression guard. agentex 0.0.34 reads `instructionsFile` in
    // `session.ts` only for claude/codex/pi — for cursor and opencode it lives
    // in `execute.ts`, which Ri never uses. Marking these `prompt-only`
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
    for (const provider of ['claude', 'codex', 'opencode', 'antigravity']) {
      const wiring = referenceFolderProviderWiring(empty, provider);
      expect(wiring.deliversInstructions).toBe(false);
      expect(wiring.extraArgs).toEqual([]);
      expect(wiring.disallowedTools).toEqual([]);
    }
  });
});

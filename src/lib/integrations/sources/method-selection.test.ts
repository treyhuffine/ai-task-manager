import { describe, expect, it } from 'vitest';
import { overrideForChoice, selectConnectionMethod, type SelectionInput } from './method-selection';
import { EMPTY_PREFERENCES, type SourceEntry, type SourcePreferences } from './types';

const composio = (overrides: Partial<SourceEntry> = {}): SourceEntry => ({
  id: 'cmpaaaa', kind: 'composio', label: 'Composio', enabled: true, remoteUserId: `ri-${'a'.repeat(32)}`,
  createdAt: '2026-10-15T00:00:00.000Z', ...overrides,
});

function input(prefs: Partial<SourcePreferences>, overrides: Partial<SelectionInput> = {}): SelectionInput {
  return {
    applicationId: 'gmail', capability: 'agent_tools',
    preferences: { ...structuredClone(EMPTY_PREFERENCES), ...prefs },
    health: {}, direct: { providerId: 'google', configured: false },
    ...overrides,
  };
}

describe('selectConnectionMethod', () => {
  it('uses the preferred source', () => {
    const selection = selectConnectionMethod(input({ sources: [composio()], preferredSourceId: 'cmpaaaa' }));
    expect(selection.basis).toBe('preferred');
    expect(selection.primary).toMatchObject({ kind: 'managed', method: { sourceId: 'cmpaaaa' } });
    expect(selection.alternatives.map(option => option.kind)).toEqual(['direct']);
  });

  it('lets an explicit application override win over the overall preference', () => {
    const selection = selectConnectionMethod(input(
      { sources: [composio()], preferredSourceId: 'cmpaaaa', applicationMethods: { gmail: { kind: 'direct', providerId: 'google' } } },
      { direct: { providerId: 'google', configured: true } },
    ));
    expect(selection.basis).toBe('override');
    expect(selection.primary).toMatchObject({ kind: 'direct' });
  });

  it('recommends a working direct route first when nothing is preferred', () => {
    const selection = selectConnectionMethod(input({ sources: [composio()] }, { direct: { providerId: 'google', configured: true } }));
    expect(selection.basis).toBe('recommended');
    expect(selection.primary?.kind).toBe('direct');
    expect(selection.alternatives[0]).toMatchObject({ kind: 'managed', available: true });
  });

  it('recommends an enabled source when the direct route needs setup', () => {
    const selection = selectConnectionMethod(input({ sources: [composio()] }));
    expect(selection.primary).toMatchObject({ kind: 'managed' });
    expect(selection.alternatives).toEqual([expect.objectContaining({ kind: 'direct', available: false })]);
  });

  it('explains a disabled preference and offers the next suitable method', () => {
    const selection = selectConnectionMethod(input(
      { sources: [composio({ enabled: false })], preferredSourceId: 'cmpaaaa' },
      { direct: { providerId: 'google', configured: true } },
    ));
    expect(selection.basis).toBe('fallback');
    expect(selection.notice).toMatch(/turned off/);
    expect(selection.primary?.kind).toBe('direct');
  });

  it('explains an unhealthy preference', () => {
    const selection = selectConnectionMethod(input(
      { sources: [composio()], preferredSourceId: 'cmpaaaa' },
      { health: { cmpaaaa: { usable: false, reason: 'The Composio key was rejected.' } } },
    ));
    expect(selection.basis).toBe('none');
    expect(selection.primary).toBeNull();
    expect(selection.notice).toBe('The Composio key was rejected.');
  });

  it('never offers a source for a capability it lacks', () => {
    const selection = selectConnectionMethod(input(
      { sources: [composio()], preferredSourceId: 'cmpaaaa' },
      { capability: 'calendar_view', applicationId: 'gmail', direct: { providerId: 'google', configured: true } },
    ));
    expect(selection.primary?.kind).toBe('direct');
    expect(selection.notice).toMatch(/can't do this/);
  });

  it('offers Composio setup last when no source is set up', () => {
    const selection = selectConnectionMethod(input({}));
    expect(selection.primary).toBeNull();
    expect(selection.alternatives.at(-1)).toMatchObject({ kind: 'setup', sourceKind: 'composio' });
  });

  it('handles a stale override as unavailable and falls through', () => {
    const selection = selectConnectionMethod(input({ sources: [composio()], applicationMethods: { gmail: { sourceId: 'cmpzzzz' } } }));
    expect(selection.notice).toMatch(/no longer exists/);
    expect(selection.primary).toMatchObject({ kind: 'managed', method: { sourceId: 'cmpaaaa' } });
  });
});

describe('overrideForChoice', () => {
  const selection = selectConnectionMethod(input({ sources: [composio()], preferredSourceId: 'cmpaaaa' }, { direct: { providerId: 'google', configured: true } }));

  it('records an explicit different method', () => {
    expect(overrideForChoice(selection, { kind: 'direct', providerId: 'google' }, true)).toEqual({ kind: 'direct', providerId: 'google' });
  });

  it('records nothing for accepting the recommendation or re-picking the preferred source', () => {
    expect(overrideForChoice(selection, { kind: 'direct', providerId: 'google' }, false)).toBeNull();
    expect(overrideForChoice(selection, { sourceId: 'cmpaaaa' }, true)).toBeNull();
  });
});

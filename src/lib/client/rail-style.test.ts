import { describe, expect, it } from 'vitest';
import { DEFAULT_RAIL_STYLE, parseRailStyle } from './rail-style';

/** The agents-first rail trial preference (docs/rail-agents-first.md). */
describe('parseRailStyle', () => {
  it('defaults to agents first, and narrows anything unknown to the default', () => {
    expect(DEFAULT_RAIL_STYLE).toBe('agents');
    expect(parseRailStyle('classic')).toBe('classic');
    expect(parseRailStyle('agents')).toBe('agents');
    for (const raw of [null, undefined, '', 'workspace', 1]) expect(parseRailStyle(raw)).toBe('agents');
  });
});

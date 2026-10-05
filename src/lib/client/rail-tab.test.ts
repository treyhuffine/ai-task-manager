import { describe, expect, it } from 'vitest';
import { DEFAULT_RAIL_TAB, parseRailTab } from './rail-tab';

describe('parseRailTab', () => {
  it('keeps the two tabs', () => {
    expect(parseRailTab('workspace')).toBe('workspace');
    expect(parseRailTab('history')).toBe('history');
  });

  it('reads the removed Status tab as the default', () => {
    expect(parseRailTab('status')).toBe(DEFAULT_RAIL_TAB);
  });

  it('defaults anything else', () => {
    expect(parseRailTab(null)).toBe(DEFAULT_RAIL_TAB);
    expect(parseRailTab('recent')).toBe(DEFAULT_RAIL_TAB);
  });
});

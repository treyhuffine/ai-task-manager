import { describe, it, expect } from 'vitest';
import { formatChangedCount } from './tree-view-toggle';

describe('formatChangedCount', () => {
  it('shows the exact count up to 99', () => {
    expect(formatChangedCount(0)).toBe('0');
    expect(formatChangedCount(13)).toBe('13');
    expect(formatChangedCount(99)).toBe('99');
  });

  it('caps at 99+ instead of listing thousands', () => {
    expect(formatChangedCount(100)).toBe('99+');
    expect(formatChangedCount(4210)).toBe('99+');
  });
});

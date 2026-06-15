import { describe, expect, it } from 'vitest';
import { formatCompactCount } from './compact-number';

describe('formatCompactCount', () => {
  it('keeps small counts exact', () => {
    expect(formatCompactCount(0)).toBe('0');
    expect(formatCompactCount(7)).toBe('7');
    expect(formatCompactCount(999)).toBe('999');
  });

  it('folds thousands to one decimal, lowercase suffix', () => {
    expect(formatCompactCount(1000)).toBe('1k');
    expect(formatCompactCount(1234)).toBe('1.2k');
    expect(formatCompactCount(12345)).toBe('12.3k');
  });

  it('folds millions', () => {
    expect(formatCompactCount(1_200_000)).toBe('1.2m');
  });
});

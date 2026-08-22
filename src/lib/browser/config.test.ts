import { describe, it, expect } from 'vitest';
import { resolveProfile } from './config';

describe('resolveProfile', () => {
  it('accepts path-safe names', () => {
    expect(resolveProfile('agent')).toBe('agent');
    expect(resolveProfile('medium')).toBe('medium');
    expect(resolveProfile('a_b-1')).toBe('a_b-1');
  });

  it('rejects path-unsafe names', () => {
    expect(() => resolveProfile('../etc')).toThrow();
    expect(() => resolveProfile('a/b')).toThrow();
    expect(() => resolveProfile('has space')).toThrow();
    expect(() => resolveProfile('')).toThrow();
    expect(() => resolveProfile('a'.repeat(65))).toThrow();
  });
});

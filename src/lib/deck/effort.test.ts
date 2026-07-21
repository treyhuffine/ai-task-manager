import { describe, expect, it } from 'vitest';
import { DEFAULT_EFFORT_MINUTES, effortMinutes } from './effort';

describe('effortMinutes', () => {
  it('maps the DB enum values', () => {
    expect(effortMinutes('trivial')).toBe(15);
    expect(effortMinutes('small')).toBe(30);
    expect(effortMinutes('medium')).toBe(60);
    expect(effortMinutes('large')).toBe(120);
    expect(effortMinutes('epic')).toBe(240);
  });
  it('maps the XS-XL display shorthand', () => {
    expect(effortMinutes('XS')).toBe(15);
    expect(effortMinutes('S')).toBe(30);
    expect(effortMinutes('M')).toBe(60);
    expect(effortMinutes('L')).toBe(120);
    expect(effortMinutes('XL')).toBe(240);
  });
  it('is case/whitespace tolerant', () => {
    expect(effortMinutes(' xl ')).toBe(240);
  });
  it('unknown or missing effort falls back to the default band', () => {
    expect(effortMinutes(null)).toBe(DEFAULT_EFFORT_MINUTES);
    expect(effortMinutes(undefined)).toBe(DEFAULT_EFFORT_MINUTES);
    expect(effortMinutes('HUGE')).toBe(DEFAULT_EFFORT_MINUTES);
  });
});

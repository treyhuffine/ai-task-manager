import { describe, it, expect } from 'vitest';
import { formatElapsed, formatSpanSeconds } from './duration';

describe('formatElapsed', () => {
  it('shows seconds under a minute', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(45)).toBe('45s');
    expect(formatElapsed(59)).toBe('59s');
  });

  it('steps up to minutes + seconds', () => {
    expect(formatElapsed(60)).toBe('1m 0s');
    expect(formatElapsed(134)).toBe('2m 14s');
    expect(formatElapsed(3599)).toBe('59m 59s');
  });

  it('steps up to hours but always keeps seconds ticking', () => {
    expect(formatElapsed(3600)).toBe('1h 0m 0s');
    expect(formatElapsed(3920)).toBe('1h 5m 20s');
    expect(formatElapsed(86399)).toBe('23h 59m 59s');
  });

  it('steps up to days but always keeps seconds ticking', () => {
    expect(formatElapsed(86400)).toBe('1d 0h 0m 0s');
    expect(formatElapsed(180120)).toBe('2d 2h 2m 0s');
  });

  it('clamps junk input to 0s', () => {
    expect(formatElapsed(-5)).toBe('0s');
    expect(formatElapsed(NaN)).toBe('0s');
  });
});

describe('formatSpanSeconds', () => {
  it('returns null below a second', () => {
    expect(formatSpanSeconds(0.4)).toBeNull();
    expect(formatSpanSeconds(-1)).toBeNull();
  });

  it('keeps sub-10s decimals', () => {
    expect(formatSpanSeconds(7.4)).toBe('7.4s');
    expect(formatSpanSeconds(12)).toBe('12s');
  });

  it('drops a zero trailing unit on static spans', () => {
    expect(formatSpanSeconds(120)).toBe('2m');
    expect(formatSpanSeconds(134)).toBe('2m 14s');
    expect(formatSpanSeconds(3600)).toBe('1h');
    expect(formatSpanSeconds(3920)).toBe('1h 5m');
    expect(formatSpanSeconds(86400)).toBe('1d');
    expect(formatSpanSeconds(180120)).toBe('2d 2h');
  });
});

import { describe, expect, it } from 'vitest';
import { holdsRunning } from './steady-running';

describe('holding a turn as working across a boundary (P3.7)', () => {
  it('holds a drop that brings no outcome', () => {
    expect(holdsRunning({ running: true, outcome: null }, false, null)).toBe(true);
    expect(holdsRunning({ running: true, outcome: 't1' }, false, 't1')).toBe(true);
  });

  it('never holds a turn that really ended, or one that was not running', () => {
    expect(holdsRunning({ running: true, outcome: null }, false, 't1')).toBe(false);
    expect(holdsRunning({ running: true, outcome: 't1' }, false, 't2')).toBe(false);
    expect(holdsRunning({ running: false, outcome: null }, false, null)).toBe(false);
    expect(holdsRunning({ running: false, outcome: null }, true, null)).toBe(false);
  });
});

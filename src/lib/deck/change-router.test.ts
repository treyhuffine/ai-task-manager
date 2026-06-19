import { describe, it, expect } from 'vitest';
import {
  routeChange,
  routeChanges,
  DEFAULT_INTERRUPT_BUDGET,
  type ProposedChange,
  type RouterContext,
} from './change-router';

function change(overrides: Partial<ProposedChange> = {}): ProposedChange {
  return { kind: 'added', taskId: 't', reason: 'r', source: 'calendar', ...overrides };
}

const calm: RouterContext = { inFocus: false, interruptsToday: 0 };

describe('routeChange', () => {
  it('absorbs a minor, clean change by default', () => {
    expect(routeChange(change({ kind: 'added', magnitude: 'minor' }), calm).channel).toBe('absorb');
  });

  it('digests items that moved off the deck', () => {
    expect(routeChange(change({ kind: 'deferred' }), calm).channel).toBe('digest');
    expect(routeChange(change({ kind: 'dropped' }), calm).channel).toBe('digest');
    expect(routeChange(change({ kind: 'bumped' }), calm).channel).toBe('digest');
  });

  it('digests anything touching a prioritized item', () => {
    expect(routeChange(change({ kind: 'added', touchesPriority: true }), calm).channel).toBe('digest');
  });

  it('interrupts only when a decision is needed AND it cannot wait', () => {
    expect(routeChange(change({ needsDecision: true, timeSensitive: true }), calm).channel).toBe('interrupt');
    // Missing either signal → not an interrupt.
    expect(routeChange(change({ needsDecision: true, timeSensitive: false }), calm).channel).not.toBe('interrupt');
    expect(routeChange(change({ needsDecision: false, timeSensitive: true }), calm).channel).not.toBe('interrupt');
  });

  it('downgrades an interrupt to digest when the budget is spent', () => {
    const ctx: RouterContext = { inFocus: false, interruptsToday: DEFAULT_INTERRUPT_BUDGET };
    expect(routeChange(change({ needsDecision: true, timeSensitive: true }), ctx).channel).toBe('digest');
  });

  it('holds a non-major interrupt during a focus block', () => {
    const ctx: RouterContext = { inFocus: true, interruptsToday: 0 };
    expect(routeChange(change({ needsDecision: true, timeSensitive: true, magnitude: 'notable' }), ctx).channel).toBe('digest');
  });

  it('lets a major interrupt pierce a focus block', () => {
    const ctx: RouterContext = { inFocus: true, interruptsToday: 0 };
    expect(routeChange(change({ needsDecision: true, timeSensitive: true, magnitude: 'major' }), ctx).channel).toBe('interrupt');
  });

  it('mutes a learned-dismissed kind down to absorb', () => {
    const ctx: RouterContext = { inFocus: false, interruptsToday: 0, mutedKinds: new Set(['deferred']) };
    expect(routeChange(change({ kind: 'deferred', needsDecision: true, timeSensitive: true }), ctx).channel).toBe('absorb');
  });
});

describe('routeChanges (batch budget)', () => {
  it('consumes the interrupt budget across the batch', () => {
    const ctx: RouterContext = { inFocus: false, interruptsToday: 0, interruptBudget: 1 };
    const batch = [
      change({ taskId: 'a', needsDecision: true, timeSensitive: true }),
      change({ taskId: 'b', needsDecision: true, timeSensitive: true }),
    ];
    const routed = routeChanges(batch, ctx);
    expect(routed[0].decision.channel).toBe('interrupt');
    expect(routed[1].decision.channel).toBe('digest'); // budget exhausted by the first
  });
});

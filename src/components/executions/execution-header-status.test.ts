import { describe, expect, it } from 'vitest';
import { deriveExecutionHeaderStatus, describeChatStatus } from './execution-header-status';

const base = {
  isArchived: false,
  isSetupFailed: false,
  isSettingUp: false,
  isPending: false,
  isRunning: false,
  hasBackgroundTasks: false,
  lastOutcomeEventAt: null,
  lastViewedAt: null,
};

describe('deriveExecutionHeaderStatus', () => {
  it('uses the direct runtime state even when persisted outcome data looks idle', () => {
    expect(deriveExecutionHeaderStatus({
      ...base,
      isRunning: true,
      lastOutcomeEventAt: '2026-07-15T20:00:00.000Z',
      lastViewedAt: '2026-07-15T20:01:00.000Z',
    })).toBe('working');
  });

  it('returns to idle after the direct runtime state stops', () => {
    expect(deriveExecutionHeaderStatus({
      ...base,
      lastOutcomeEventAt: '2026-07-15T20:00:00.000Z',
      lastViewedAt: '2026-07-15T20:01:00.000Z',
    })).toBe('idle');
  });

  it('distinguishes child work that outlives the root turn', () => {
    expect(deriveExecutionHeaderStatus({
      ...base,
      hasBackgroundTasks: true,
      lastOutcomeEventAt: '2026-07-15T20:00:00.000Z',
      lastViewedAt: '2026-07-15T20:01:00.000Z',
    })).toBe('background');
  });

  it('keeps foreground working ahead of background work', () => {
    expect(deriveExecutionHeaderStatus({
      ...base,
      isRunning: true,
      hasBackgroundTasks: true,
    })).toBe('working');
  });

  it('keeps pending input ahead of a running process', () => {
    expect(deriveExecutionHeaderStatus({
      ...base,
      isPending: true,
      isRunning: true,
    })).toBe('pending');
  });
});

describe('describeChatStatus', () => {
  const ago = (value: string) => () => value;

  it('says when a turn finished instead of a vague "ready"', () => {
    expect(describeChatStatus('idle', '2026-07-15T20:00:00.000Z', ago('5m')).label).toBe('Finished 5m ago');
    expect(describeChatStatus('respond', '2026-07-15T20:00:00.000Z', ago('now')).label).toBe('Finished just now');
    expect(describeChatStatus('idle', '2026-07-15T20:00:00.000Z', ago('Mar 12')).label).toBe('Finished Mar 12');
  });

  it('keeps background work visible after the turn ends', () => {
    const s = describeChatStatus('background', '2026-07-15T20:00:00.000Z', ago('3m'));
    expect(s).toMatchObject({ label: 'Finished 3m ago', detail: 'background task running', tone: 'sky', pulse: false });
  });

  it('background work never looks like the agent working', () => {
    const working = describeChatStatus('working', null, ago(''));
    const background = describeChatStatus('background', '2026-07-15T20:00:00.000Z', ago('3m'));
    expect(background.tone).not.toBe(working.tone);
    expect(background.pulse).toBe(false);
    expect(background.label).not.toMatch(/working/i);
  });

  it('names the states that need the user', () => {
    expect(describeChatStatus('pending', null, ago('')).label).toBe('Needs input');
    expect(describeChatStatus('setup-failed', null, ago('')).tone).toBe('rose');
  });

  it('a chat with no turns yet is not "finished"', () => {
    expect(describeChatStatus('ready', null, ago('')).label).toBe('Not started');
  });

  it('never says "Ready"', () => {
    const kinds = ['archived', 'setup-failed', 'setting-up', 'pending', 'working', 'background', 'respond', 'idle', 'ready'] as const;
    for (const k of kinds) expect(describeChatStatus(k, '2026-07-15T20:00:00.000Z', ago('1m')).label).not.toMatch(/ready/i);
  });
});

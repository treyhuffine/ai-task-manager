import { describe, it, expect } from 'vitest';
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  TRANSITION_COMMANDS,
  LIFECYCLE_COMMANDS,
  normalizeTaskStatus,
  isTaskStatus,
  isTransitionCommand,
  canApply,
  targetState,
  availableCommands,
  transitionLabel,
  isOpen,
  isCommitted,
  isWip,
  isTerminal,
  isMergeable,
  isCalendarVisible,
  isAmbientSuggestable,
  isReady,
  isDeckEligible,
  considerBlockers,
  type TaskStatus,
  type LifecycleCommand,
} from './lifecycle';

describe('status vocabulary', () => {
  it('is exactly the five canonical states', () => {
    expect([...TASK_STATUSES]).toEqual(['consider', 'todo', 'in_progress', 'done', 'archived']);
  });

  it('labels every state', () => {
    for (const s of TASK_STATUSES) expect(TASK_STATUS_LABELS[s]).toBeTruthy();
    expect(TASK_STATUS_LABELS.in_progress).toBe('In progress');
  });

  it('isTaskStatus recognizes canonical values and rejects legacy/unknown', () => {
    expect(isTaskStatus('todo')).toBe(true);
    expect(isTaskStatus('active')).toBe(false);
    expect(isTaskStatus('nope')).toBe(false);
    expect(isTaskStatus(null)).toBe(false);
  });

  it('normalizeTaskStatus maps legacy active and unknown/null to todo, passes canonical through', () => {
    expect(normalizeTaskStatus('active')).toBe('todo');
    expect(normalizeTaskStatus('mystery')).toBe('todo');
    expect(normalizeTaskStatus(null)).toBe('todo');
    expect(normalizeTaskStatus(undefined)).toBe('todo');
    for (const s of TASK_STATUSES) expect(normalizeTaskStatus(s)).toBe(s);
  });
});

// The canonical transition matrix from the spec.
const MATRIX: Record<LifecycleCommand, { from: TaskStatus[]; to: TaskStatus }> = {
  move_to_todo: { from: ['consider'], to: 'todo' },
  move_to_consider: { from: ['todo'], to: 'consider' },
  start: { from: ['consider', 'todo'], to: 'in_progress' },
  return_to_todo: { from: ['in_progress'], to: 'todo' },
  complete: { from: ['todo', 'in_progress'], to: 'done' },
  reopen: { from: ['done'], to: 'todo' },
  archive: { from: ['consider', 'todo', 'in_progress'], to: 'archived' },
  restore: { from: ['archived'], to: 'todo' },
};

describe('transition matrix (every command x every source state)', () => {
  for (const command of LIFECYCLE_COMMANDS) {
    const def = MATRIX[command];
    for (const from of TASK_STATUSES) {
      const legal = def.from.includes(from);
      it(`${command} from ${from} is ${legal ? 'legal' : 'illegal'}`, () => {
        expect(canApply(command, from)).toBe(legal);
      });
    }
    it(`${command} targets ${def.to}`, () => {
      expect(targetState(command)).toBe(def.to);
    });
  }

  it('availableCommands returns exactly the legal commands per state', () => {
    expect(availableCommands('consider').sort()).toEqual(['archive', 'move_to_todo', 'start'].sort());
    expect(availableCommands('todo').sort()).toEqual(['archive', 'complete', 'move_to_consider', 'start'].sort());
    expect(availableCommands('in_progress').sort()).toEqual(['archive', 'complete', 'return_to_todo'].sort());
    expect(availableCommands('done')).toEqual(['reopen']);
    expect(availableCommands('archived')).toEqual(['restore']);
  });

  it('done can never be archived (Done stays Done)', () => {
    expect(canApply('archive', 'done')).toBe(false);
  });

  it('terminal states cannot be started', () => {
    expect(canApply('start', 'done')).toBe(false);
    expect(canApply('start', 'archived')).toBe(false);
  });

  it('transitionLabel is human-facing', () => {
    expect(transitionLabel('move_to_consider')).toBe('Move to Consider');
  });

  it('TRANSITION_COMMANDS excludes complete (which has its own path)', () => {
    expect(TRANSITION_COMMANDS).not.toContain('complete');
    expect(isTransitionCommand('complete')).toBe(false);
    expect(isTransitionCommand('start')).toBe(true);
  });
});

describe('derived predicates', () => {
  it('isOpen = not terminal', () => {
    expect(TASK_STATUSES.filter(isOpen)).toEqual(['consider', 'todo', 'in_progress']);
  });
  it('isCommitted = the derived current union (replaces active)', () => {
    expect(TASK_STATUSES.filter(isCommitted)).toEqual(['todo', 'in_progress']);
  });
  it('isWip = in_progress only', () => {
    expect(TASK_STATUSES.filter(isWip)).toEqual(['in_progress']);
  });
  it('isTerminal = done | archived', () => {
    expect(TASK_STATUSES.filter(isTerminal)).toEqual(['done', 'archived']);
  });
  it('isMergeable = open (stream merge targets)', () => {
    expect(TASK_STATUSES.filter(isMergeable)).toEqual(['consider', 'todo', 'in_progress']);
  });
  it('isCalendarVisible = committed (Consider stays off the commitment calendar)', () => {
    expect(TASK_STATUSES.filter(isCalendarVisible)).toEqual(['todo', 'in_progress']);
  });
  it('isAmbientSuggestable = in_progress then todo, never consider/terminal', () => {
    expect(TASK_STATUSES.filter(isAmbientSuggestable)).toEqual(['todo', 'in_progress']);
    expect(isAmbientSuggestable('consider')).toBe(false);
  });
});

describe('isReady / isDeckEligible', () => {
  const base = {
    status: 'todo' as TaskStatus,
    hasUnresolvedBlocker: false,
    resurfaceAfter: null,
    recurrence: null,
    nextRecurrenceAt: null,
    now: '2026-09-01T00:00:00.000Z',
  };

  it('ready when todo, unblocked, no snooze, no pending recurrence', () => {
    expect(isReady(base)).toBe(true);
    expect(isDeckEligible(base)).toBe(true);
  });
  it('in_progress is NOT ready (it lives in Current Work, not the stack)', () => {
    expect(isReady({ ...base, status: 'in_progress' })).toBe(false);
  });
  it('consider is never ready', () => {
    expect(isReady({ ...base, status: 'consider' })).toBe(false);
  });
  it('an unresolved blocker blocks readiness', () => {
    expect(isReady({ ...base, hasUnresolvedBlocker: true })).toBe(false);
  });
  it('a future resurfaceAfter blocks readiness; a past one does not', () => {
    expect(isReady({ ...base, resurfaceAfter: '2026-09-02T00:00:00.000Z' })).toBe(false);
    expect(isReady({ ...base, resurfaceAfter: '2026-08-01T00:00:00.000Z' })).toBe(true);
  });
  it('a recurring task not yet due is not ready; due is ready', () => {
    expect(isReady({ ...base, recurrence: 'weekly', nextRecurrenceAt: '2026-09-05T00:00:00.000Z' })).toBe(false);
    expect(isReady({ ...base, recurrence: 'weekly', nextRecurrenceAt: '2026-08-30T00:00:00.000Z' })).toBe(true);
  });
});

describe('considerBlockers (Todo -> Consider preconditions)', () => {
  const clean = { hardDeadline: null, recurrence: null, hasUnresolvedBlocker: false, hasLiveOwningExecution: false };
  it('allows the move when nothing commitment-bearing is present', () => {
    expect(considerBlockers(clean)).toEqual([]);
  });
  it('lists each commitment-bearing fact that blocks the move', () => {
    expect(considerBlockers({ ...clean, hardDeadline: '2026-12-31' })).toContain('a hard deadline');
    expect(considerBlockers({ ...clean, recurrence: 'weekly' })).toContain('a recurrence');
    expect(considerBlockers({ ...clean, hasUnresolvedBlocker: true })).toContain('an unresolved blocker');
    expect(considerBlockers({ ...clean, hasLiveOwningExecution: true })).toContain('a live owning execution');
    expect(considerBlockers({ hardDeadline: 'x', recurrence: 'y', hasUnresolvedBlocker: true, hasLiveOwningExecution: true })).toHaveLength(4);
  });
});

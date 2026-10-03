import { describe, expect, it } from 'vitest';
import { DEFAULT_HOME_PANELS, panelForTab } from './home-panels';

describe('DEFAULT_HOME_PANELS', () => {
  it('opens home with the chat on the left and the deck on the right', () => {
    expect(DEFAULT_HOME_PANELS).toEqual({ a: 'chat', b: 'deck' });
  });
});

describe('panelForTab', () => {
  it('leaves a tab that is already on screen where it is', () => {
    expect(panelForTab({ a: 'chat', b: 'deck' }, 'deck')).toBeNull();
    expect(panelForTab({ a: 'chat', b: 'deck' }, 'chat')).toBeNull();
    expect(panelForTab({ a: 'tasks', b: 'chat' }, 'tasks')).toBeNull();
  });

  it('shows other tabs on the right, beside the chat', () => {
    expect(panelForTab({ a: 'chat', b: 'deck' }, 'tasks')).toBe('b');
    expect(panelForTab({ a: 'chat', b: 'notes' }, 'deck')).toBe('b');
  });

  it('never covers the chat when it has been moved to the right', () => {
    expect(panelForTab({ a: 'deck', b: 'chat' }, 'tasks')).toBe('a');
  });

  it('brings the chat back on the left', () => {
    expect(panelForTab({ a: 'tasks', b: 'deck' }, 'chat')).toBe('a');
  });

  it('puts a tab on the right when the chat is not showing', () => {
    expect(panelForTab({ a: 'tasks', b: 'notes' }, 'deck')).toBe('b');
  });
});

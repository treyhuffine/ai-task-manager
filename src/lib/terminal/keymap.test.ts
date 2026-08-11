import { describe, expect, it } from 'vitest';
import { resolveTerminalKey, type TerminalKeyEvent } from './keymap';

/** A keydown with no modifiers held, overridden per case. */
function key(over: Partial<TerminalKeyEvent> & { key: string }): TerminalKeyEvent {
  return { metaKey: false, altKey: false, ctrlKey: false, shiftKey: false, ...over };
}

describe('resolveTerminalKey', () => {
  // The three combos this module exists to fix. Expected bytes were
  // verified against a live PTY: each one produces the documented readline
  // behaviour in both bash and zsh.
  it('maps the combos xterm leaves broken', () => {
    expect(resolveTerminalKey(key({ key: 'Backspace', metaKey: true }), true)).toBe('\x15');
    expect(resolveTerminalKey(key({ key: 'Delete', metaKey: true }), true)).toBe('\x0b');
    expect(resolveTerminalKey(key({ key: 'ArrowLeft', metaKey: true }), true)).toBe('\x01');
    expect(resolveTerminalKey(key({ key: 'ArrowRight', metaKey: true }), true)).toBe('\x05');
    expect(resolveTerminalKey(key({ key: 'ArrowLeft', altKey: true }), true)).toBe('\x1bb');
    expect(resolveTerminalKey(key({ key: 'ArrowRight', altKey: true }), true)).toBe('\x1bf');
  });

  it('never emits the ESC [1;3 sequences that caused the bug', () => {
    // Readline can't match `ESC [1;3D`, so it rings the bell and drops the
    // tail into the line buffer as literal `;3D` text. Anything we emit for
    // a word jump has to be a sequence the shells actually bind.
    for (const k of ['ArrowLeft', 'ArrowRight']) {
      const out = resolveTerminalKey(key({ key: k, altKey: true }), true);
      expect(out).not.toContain('[1;');
    }
  });

  it('gates Cmd bindings on macOS but not Option bindings', () => {
    // Super+Left belongs to the window manager off macOS.
    expect(resolveTerminalKey(key({ key: 'ArrowLeft', metaKey: true }), false)).toBeNull();
    expect(resolveTerminalKey(key({ key: 'Backspace', metaKey: true }), false)).toBeNull();
    // Alt is the conventional Meta prefix everywhere, so `ESC b` is right
    // on Linux and Windows too.
    expect(resolveTerminalKey(key({ key: 'ArrowLeft', altKey: true }), false)).toBe('\x1bb');
  });

  it('leaves Ctrl combos to xterm so control codes keep working', () => {
    // Ctrl+C must stay SIGINT and Ctrl+A must stay beginning-of-line —
    // claiming either here would break the terminal outright.
    expect(resolveTerminalKey(key({ key: 'ArrowLeft', ctrlKey: true }), true)).toBeNull();
    expect(resolveTerminalKey(key({ key: 'Backspace', ctrlKey: true }), true)).toBeNull();
    expect(resolveTerminalKey(key({ key: 'c', ctrlKey: true }), true)).toBeNull();
  });

  it('requires an exact modifier set', () => {
    // Shift means selection, not navigation.
    expect(resolveTerminalKey(key({ key: 'ArrowLeft', metaKey: true, shiftKey: true }), true)).toBeNull();
    expect(resolveTerminalKey(key({ key: 'ArrowLeft', altKey: true, shiftKey: true }), true)).toBeNull();
    // Cmd+Option+Left isn't a shell binding either way.
    expect(resolveTerminalKey(key({ key: 'ArrowLeft', metaKey: true, altKey: true }), true)).toBeNull();
  });

  it('passes through everything it has no opinion about', () => {
    // Option+Backspace already emits ESC DEL correctly in xterm; taking it
    // over here would be a regression risk for no gain.
    expect(resolveTerminalKey(key({ key: 'Backspace', altKey: true }), true)).toBeNull();
    expect(resolveTerminalKey(key({ key: 'Backspace' }), true)).toBeNull();
    expect(resolveTerminalKey(key({ key: 'a' }), true)).toBeNull();
    expect(resolveTerminalKey(key({ key: 'ArrowUp', metaKey: true }), true)).toBeNull();
    expect(resolveTerminalKey(key({ key: 'v', metaKey: true }), true)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { HOTKEYS, matchesHotkey } from './commands';

function key(init: Partial<Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>>): KeyboardEvent {
  return { key: '', code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init } as KeyboardEvent;
}

describe('matchesHotkey', () => {
  it('matches the tools toggle by its physical key, whatever character Option makes', () => {
    // A Mac reports ⌥⌘B as key "∫"; Windows and Linux report "b" with Ctrl.
    expect(matchesHotkey(key({ key: '∫', code: 'KeyB', metaKey: true, altKey: true }), HOTKEYS.toggleTools)).toBe(true);
    expect(matchesHotkey(key({ key: 'b', code: 'KeyB', ctrlKey: true, altKey: true }), HOTKEYS.toggleTools)).toBe(true);
  });

  it('keeps the tools toggle off bold and the other B combinations', () => {
    expect(matchesHotkey(key({ key: 'b', code: 'KeyB', metaKey: true }), HOTKEYS.toggleTools)).toBe(false);
    expect(matchesHotkey(key({ key: '∫', code: 'KeyB', altKey: true }), HOTKEYS.toggleTools)).toBe(false);
    expect(matchesHotkey(key({ key: 'B', code: 'KeyB', metaKey: true, altKey: true, shiftKey: true }), HOTKEYS.toggleTools)).toBe(false);
    expect(matchesHotkey(key({ key: 'n', code: 'KeyN', metaKey: true, altKey: true }), HOTKEYS.toggleTools)).toBe(false);
  });

  it('leaves hotkeys without Option matching by character, as before', () => {
    expect(matchesHotkey(key({ key: 'k', metaKey: true }), HOTKEYS.search)).toBe(true);
    expect(matchesHotkey(key({ key: '`', ctrlKey: true }), HOTKEYS.toggleTerminal)).toBe(true);
    expect(matchesHotkey(key({ key: 'K', metaKey: true, shiftKey: true }), HOTKEYS.quickCapture)).toBe(true);
    expect(matchesHotkey(key({ key: 'k', metaKey: true, shiftKey: true }), HOTKEYS.search)).toBe(false);
  });
});

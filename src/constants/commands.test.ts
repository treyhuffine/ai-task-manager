import { describe, expect, it } from 'vitest';
import { HOTKEYS, matchesHotkey } from './commands';

function key(init: Partial<Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>>): KeyboardEvent {
  return { key: '', code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init } as KeyboardEvent;
}

describe('matchesHotkey', () => {
  it.each([
    ['tools', '.', 'Period', HOTKEYS.toggleTools],
    ['terminal', '`', 'Backquote', HOTKEYS.toggleTerminal],
  ] as const)('toggles %s with literal Control on every platform', (_name, character, code, hotkey) => {
    expect(matchesHotkey(key({ key: character, code, ctrlKey: true }), hotkey)).toBe(true);
    expect(matchesHotkey(key({ key: character, code, metaKey: true }), hotkey)).toBe(false);
    expect(matchesHotkey(key({ key: character, code, ctrlKey: true, metaKey: true }), hotkey)).toBe(false);
    expect(matchesHotkey(key({ key: character, code, ctrlKey: true, shiftKey: true }), hotkey)).toBe(false);
    expect(matchesHotkey(key({ key: character, code, ctrlKey: true, altKey: true }), hotkey)).toBe(false);
    expect(matchesHotkey(key({ key: character, code }), hotkey)).toBe(false);
  });

  it('keeps tools off typing, bold, extra modifiers and its former shortcut', () => {
    expect(matchesHotkey(key({ key: '.', code: 'Period' }), HOTKEYS.toggleTools)).toBe(false);
    expect(matchesHotkey(key({ key: '.', code: 'Period', metaKey: true, shiftKey: true }), HOTKEYS.toggleTools)).toBe(false);
    expect(matchesHotkey(key({ key: '.', code: 'Period', ctrlKey: true, altKey: true }), HOTKEYS.toggleTools)).toBe(false);
    expect(matchesHotkey(key({ key: 'b', code: 'KeyB', metaKey: true }), HOTKEYS.toggleTools)).toBe(false);
    expect(matchesHotkey(key({ key: '∫', code: 'KeyB', metaKey: true, altKey: true }), HOTKEYS.toggleTools)).toBe(false);
    expect(matchesHotkey(key({ key: 'b', code: 'KeyB', ctrlKey: true, altKey: true }), HOTKEYS.toggleTools)).toBe(false);
  });

  it('matches Option hotkeys by their physical key, whatever character Option makes', () => {
    const hotkey = { key: 'b', meta: true, alt: true, label: '⌥⌘B' };
    expect(matchesHotkey(key({ key: '∫', code: 'KeyB', metaKey: true, altKey: true }), hotkey)).toBe(true);
    expect(matchesHotkey(key({ key: 'b', code: 'KeyB', ctrlKey: true, altKey: true }), hotkey)).toBe(true);
    expect(matchesHotkey(key({ key: 'b', code: 'KeyB', metaKey: true }), hotkey)).toBe(false);
    expect(matchesHotkey(key({ key: '∫', code: 'KeyB', altKey: true }), hotkey)).toBe(false);
    expect(matchesHotkey(key({ key: 'B', code: 'KeyB', metaKey: true, altKey: true, shiftKey: true }), hotkey)).toBe(false);
    expect(matchesHotkey(key({ key: 'n', code: 'KeyN', metaKey: true, altKey: true }), hotkey)).toBe(false);
  });

  it('leaves hotkeys without Option matching by character, as before', () => {
    expect(matchesHotkey(key({ key: 'k', metaKey: true }), HOTKEYS.search)).toBe(true);
    expect(matchesHotkey(key({ key: 'k', ctrlKey: true }), HOTKEYS.search)).toBe(true);
    expect(matchesHotkey(key({ key: '`', ctrlKey: true }), HOTKEYS.toggleTerminal)).toBe(true);
    expect(matchesHotkey(key({ key: 'K', metaKey: true, shiftKey: true }), HOTKEYS.quickCapture)).toBe(true);
    expect(matchesHotkey(key({ key: 'k', metaKey: true, shiftKey: true }), HOTKEYS.search)).toBe(false);
    expect(matchesHotkey(key({ key: 'k', ctrlKey: true, altKey: true }), HOTKEYS.search)).toBe(false);
  });
});

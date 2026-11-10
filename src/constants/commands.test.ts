import { describe, expect, it } from 'vitest';
import { HOTKEYS, matchesHotkey, matchesSendKey } from './commands';

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

  it('zooms a preview in with + whether the keyboard types it with Shift or not, and with =', () => {
    const zoomIn = (event: KeyboardEvent) => matchesHotkey(event, HOTKEYS.previewZoomIn) || matchesHotkey(event, HOTKEYS.previewZoomInEquals);
    // US Shift+=, a German keyboard's own + key, the number pad, and = alone.
    expect(zoomIn(key({ key: '+', code: 'Equal', shiftKey: true }))).toBe(true);
    expect(zoomIn(key({ key: '+', code: 'BracketRight' }))).toBe(true);
    expect(zoomIn(key({ key: '+', code: 'NumpadAdd' }))).toBe(true);
    expect(zoomIn(key({ key: '=', code: 'Equal' }))).toBe(true);
    // ⌘+ and ⌘= stay the browser's page zoom.
    expect(zoomIn(key({ key: '=', code: 'Equal', metaKey: true }))).toBe(false);
    expect(zoomIn(key({ key: '+', code: 'Equal', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(matchesHotkey(key({ key: '-', code: 'Minus' }), HOTKEYS.previewZoomOut)).toBe(true);
    expect(matchesHotkey(key({ key: '-', code: 'Minus', metaKey: true }), HOTKEYS.previewZoomOut)).toBe(false);
    expect(matchesHotkey(key({ key: '0', code: 'Digit0' }), HOTKEYS.previewZoomFit)).toBe(true);
    expect(matchesHotkey(key({ key: '0', code: 'Digit0', metaKey: true }), HOTKEYS.previewZoomFit)).toBe(false);
  });
});

describe('matchesSendKey', () => {
  const enter = (init: Partial<KeyboardEvent> = {}) => ({ ...key({ key: 'Enter', ...init }), isComposing: init.isComposing ?? false });

  it('sends on Enter from a computer, and keeps Shift+Enter for a new line', () => {
    expect(matchesSendKey(enter(), false)).toBe(true);
    expect(matchesSendKey(enter({ shiftKey: true }), false)).toBe(false);
  });

  it('leaves Enter to add a line on a touch-first device', () => {
    expect(matchesSendKey(enter(), true)).toBe(false);
    expect(matchesSendKey(enter({ shiftKey: true }), true)).toBe(false);
  });

  it('sends on ⌘↩ or Ctrl+Enter on both, for a tablet with a keyboard', () => {
    for (const touchFirst of [true, false]) {
      expect(matchesSendKey(enter({ metaKey: true }), touchFirst)).toBe(true);
      expect(matchesSendKey(enter({ ctrlKey: true }), touchFirst)).toBe(true);
    }
  });

  it('never sends on the Enter that confirms an input method candidate, or on other keys', () => {
    expect(matchesSendKey(enter({ isComposing: true }), false)).toBe(false);
    expect(matchesSendKey(enter({ isComposing: true, metaKey: true }), true)).toBe(false);
    expect(matchesSendKey(enter({ altKey: true }), false)).toBe(false);
    expect(matchesSendKey(key({ key: 'a' }), false)).toBe(false);
  });
});

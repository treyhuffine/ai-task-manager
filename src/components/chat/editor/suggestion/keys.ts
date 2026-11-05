import { HOTKEYS, matchesHotkey } from '@/constants/commands'

/**
 * Shared key semantics for the composer's suggestion menus (`/`, `@`,
 * `#`). All three popups behave identically here, and the rules are
 * subtle enough that having one copy is worth the indirection.
 */

/** Minimal shape so these stay testable without a DOM KeyboardEvent. */
export interface SuggestionKeyEvent {
  key: string
  shiftKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  isComposing?: boolean
}

/**
 * Does this keypress mean "take the highlighted item"?
 *
 * Bare Enter and bare Tab commit. Every *modified* Enter is the user
 * reaching past the menu for one of the composer's own bindings:
 * Shift+Enter inserts a newline, Cmd/Ctrl+Enter sends. Those have to
 * fall through, otherwise an open menu makes the binding unreachable
 * and there is no way to type `#1` as plain text once the PR list has
 * a match for it.
 */
export function isSuggestionCommitKey(event: SuggestionKeyEvent): boolean {
  if (event.key !== 'Enter' && event.key !== 'Tab') return false
  // Enter that closes an IME candidate is not a selection.
  if (event.isComposing) return false
  return !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey
}

/** Arrow navigation within the menu. Returns the delta, or 0. */
export function suggestionNavDelta(event: SuggestionKeyEvent): number {
  if (event.isComposing) return 0
  if (event.key === 'ArrowUp') return -1
  if (event.key === 'ArrowDown') return 1
  return 0
}

/**
 * Moving between the `@` menu's kind chips (`mentionKindPrevious` /
 * `mentionKindNext`). Returns the delta, or 0. The menu only asks while
 * nothing is searched yet, since the arrows move the caret through a search.
 */
export function suggestionKindDelta(event: SuggestionKeyEvent): number {
  if (event.isComposing) return 0
  const pressed = {
    key: event.key,
    code: '',
    metaKey: !!event.metaKey,
    ctrlKey: !!event.ctrlKey,
    shiftKey: !!event.shiftKey,
    altKey: !!event.altKey,
  }
  if (matchesHotkey(pressed, HOTKEYS.mentionKindPrevious)) return -1
  if (matchesHotkey(pressed, HOTKEYS.mentionKindNext)) return 1
  return 0
}

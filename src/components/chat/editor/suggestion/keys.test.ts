import { describe, it, expect } from 'vitest';
import { isSuggestionCommitKey, suggestionNavDelta } from './keys';

describe('isSuggestionCommitKey', () => {
  it('commits on a bare Enter', () => {
    expect(isSuggestionCommitKey({ key: 'Enter' })).toBe(true);
  });

  it('commits on a bare Tab', () => {
    expect(isSuggestionCommitKey({ key: 'Tab' })).toBe(true);
  });

  // The regression this helper exists for. With an open `#` menu, every
  // Enter was a selection — so a matching PR number made Shift+Enter
  // (newline) and Cmd+Enter (send) unreachable, and there was no way to
  // finish a message containing a literal `#1`.
  it('lets Shift+Enter through so the composer can insert a newline', () => {
    expect(isSuggestionCommitKey({ key: 'Enter', shiftKey: true })).toBe(false);
  });

  it('lets Cmd+Enter through so the composer can send', () => {
    expect(isSuggestionCommitKey({ key: 'Enter', metaKey: true })).toBe(false);
  });

  it('lets Ctrl+Enter through (the Windows/Linux send binding)', () => {
    expect(isSuggestionCommitKey({ key: 'Enter', ctrlKey: true })).toBe(false);
  });

  it('lets Alt+Enter through', () => {
    expect(isSuggestionCommitKey({ key: 'Enter', altKey: true })).toBe(false);
  });

  it('lets Shift+Tab through', () => {
    expect(isSuggestionCommitKey({ key: 'Tab', shiftKey: true })).toBe(false);
  });

  it('ignores the Enter that closes an IME candidate', () => {
    expect(isSuggestionCommitKey({ key: 'Enter', isComposing: true })).toBe(false);
  });

  it('ignores unrelated keys', () => {
    expect(isSuggestionCommitKey({ key: 'a' })).toBe(false);
    expect(isSuggestionCommitKey({ key: 'Escape' })).toBe(false);
  });
});

describe('suggestionNavDelta', () => {
  it('maps the arrow keys to a direction', () => {
    expect(suggestionNavDelta({ key: 'ArrowUp' })).toBe(-1);
    expect(suggestionNavDelta({ key: 'ArrowDown' })).toBe(1);
  });

  it('is inert for everything else', () => {
    expect(suggestionNavDelta({ key: 'ArrowLeft' })).toBe(0);
    expect(suggestionNavDelta({ key: 'Enter' })).toBe(0);
  });

  it('stays out of the way mid-IME-composition', () => {
    expect(suggestionNavDelta({ key: 'ArrowDown', isComposing: true })).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { draftStorageAction } from './draft-storage';

describe('draftStorageAction', () => {
  // The regression this whole module exists for: a freshly-mounted editor
  // fires a transient empty `onUpdate` before its restore effect runs. If
  // we treated that as "user cleared the draft" we'd delete the saved
  // draft right before reading it back, and a page reload would lose it.
  it('does NOT delete the draft before the editor has hydrated', () => {
    expect(
      draftStorageAction({ isEmpty: true, hasPendingChip: false, hydrated: false }),
    ).toBe('skip');
  });

  it('also skips a non-empty editor that has not hydrated yet', () => {
    // Defensive: nothing should touch storage during the populate window,
    // even if some transaction reports content.
    expect(
      draftStorageAction({ isEmpty: false, hasPendingChip: false, hydrated: false }),
    ).toBe('skip');
  });

  it('removes the draft when a hydrated editor is genuinely empty', () => {
    // User cleared the text, or the message was just sent (clear()).
    expect(
      draftStorageAction({ isEmpty: true, hasPendingChip: false, hydrated: true }),
    ).toBe('remove');
  });

  it('saves a hydrated editor that has content', () => {
    expect(
      draftStorageAction({ isEmpty: false, hasPendingChip: false, hydrated: true }),
    ).toBe('save');
  });

  it('skips saving while a chip is still uploading', () => {
    // A pending chip serializes as a spinner with no fileName; restoring
    // it later would strand the user with a stuck placeholder.
    expect(
      draftStorageAction({ isEmpty: false, hasPendingChip: true, hydrated: true }),
    ).toBe('skip');
  });

  it('an empty hydrated editor removes even if a (phantom) pending flag is set', () => {
    // Empty takes precedence — there is no content (pending or otherwise)
    // worth keeping, so the slot should be cleared.
    expect(
      draftStorageAction({ isEmpty: true, hasPendingChip: true, hydrated: true }),
    ).toBe('remove');
  });
});

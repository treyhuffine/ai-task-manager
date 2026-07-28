import { describe, it, expect } from 'vitest';
import { escapeClaimants, type OpenSuggestion } from './escape-guard';

function menu(isFocused: boolean): OpenSuggestion & { dismissed: number } {
  const entry = {
    dismissed: 0,
    isFocused: () => isFocused,
    dismiss: () => {
      entry.dismissed += 1;
    },
  };
  return entry;
}

describe('escapeClaimants', () => {
  it('claims Escape for a focused open menu', () => {
    const open = menu(true);
    expect(escapeClaimants({ key: 'Escape' }, [open])).toEqual([open]);
  });

  it('also accepts the legacy "Esc" key name', () => {
    const open = menu(true);
    expect(escapeClaimants({ key: 'Esc' }, [open])).toEqual([open]);
  });

  // The whole reason the guard exists: the composer lives inside a Radix
  // slideout, whose escape handler runs on document-capture and would
  // otherwise close the entire dialog on the keypress meant for the menu.
  // Claiming the key is what lets the caller preventDefault before Radix
  // looks at it.
  it('claims nothing when no menu is open, so Escape keeps its normal meaning', () => {
    expect(escapeClaimants({ key: 'Escape' }, [])).toEqual([]);
  });

  it('yields to the surrounding dialog when the editor has lost focus', () => {
    expect(escapeClaimants({ key: 'Escape' }, [menu(false)])).toEqual([]);
  });

  it('ignores every other key', () => {
    expect(escapeClaimants({ key: 'Enter' }, [menu(true)])).toEqual([]);
    expect(escapeClaimants({ key: 'a' }, [menu(true)])).toEqual([]);
  });

  it('leaves an IME composition alone — that Escape cancels the candidate', () => {
    expect(escapeClaimants({ key: 'Escape', isComposing: true }, [menu(true)])).toEqual([]);
  });

  it('picks only the focused menus when several editors are mounted', () => {
    // The execution view mounts the composer twice (mobile + desktop
    // subtrees), so two menus can be registered at once.
    const focused = menu(true);
    const background = menu(false);
    expect(escapeClaimants({ key: 'Escape' }, [background, focused])).toEqual([focused]);
  });
});

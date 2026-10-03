import { describe, expect, it } from 'vitest';
import { navigationKeyBlocked } from './history-navigation';

/** A keydown as the window listener sees it, aimed at an element inside `within`. */
function keydown(opts: { metaKey?: boolean; ctrlKey?: boolean; defaultPrevented?: boolean; within?: string | null }) {
  const target = {
    closest: (selector: string) =>
      opts.within && selector.split(',').map((s) => s.trim()).includes(opts.within) ? {} : null,
  };
  return {
    metaKey: !!opts.metaKey,
    ctrlKey: !!opts.ctrlKey,
    defaultPrevented: !!opts.defaultPrevented,
    target,
  } as unknown as KeyboardEvent;
}

describe('navigationKeyBlocked', () => {
  it('lets ⌘[ through from the page and from the chat composer, as a browser does', () => {
    expect(navigationKeyBlocked(keydown({ metaKey: true }), 'darwin')).toBe(false);
    expect(navigationKeyBlocked(keydown({ metaKey: true, within: '.ProseMirror' }), 'darwin')).toBe(false);
  });

  it('stays out of the terminal and code editors', () => {
    expect(navigationKeyBlocked(keydown({ metaKey: true, within: '.xterm' }), 'darwin')).toBe(true);
    expect(navigationKeyBlocked(keydown({ ctrlKey: true, within: '.xterm' }), 'linux')).toBe(true);
    expect(navigationKeyBlocked(keydown({ metaKey: true, within: '.cm-editor' }), 'darwin')).toBe(true);
  });

  it('leaves a key some handler already took', () => {
    expect(navigationKeyBlocked(keydown({ metaKey: true, defaultPrevented: true }), 'darwin')).toBe(true);
  });

  it('takes only the real ⌘ on a Mac, where ⌃[ is Escape', () => {
    expect(navigationKeyBlocked(keydown({ ctrlKey: true }), 'darwin')).toBe(true);
    expect(navigationKeyBlocked(keydown({ ctrlKey: true }), 'linux')).toBe(false);
  });
});

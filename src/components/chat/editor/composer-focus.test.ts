import { describe, expect, it } from 'vitest';
import { composerTarget, isComposerElement, noteComposerFocus, registerComposer, subscribeComposers, type ComposerEntry } from './composer-focus';

/** Which composer ⌘I goes to when more than one is on screen. */
function composer({ shown = true, inert = false } = {}): ComposerEntry & { state: { shown: boolean; inert: boolean } } {
  const state = { shown, inert };
  const el = {
    get isConnected() { return true; },
    getClientRects: () => (state.shown ? [{}] : []),
    closest: (selector: string) => (selector === '[inert]' && state.inert ? {} : null),
  } as unknown as HTMLElement;
  return { el, focus: () => {}, state };
}

describe('composerTarget', () => {
  it('goes to the first composer on screen until one is focused', () => {
    const main = composer();
    const beside = composer();
    const off = [registerComposer(main), registerComposer(beside)];
    expect(composerTarget()).toBe(main);
    noteComposerFocus(beside);
    expect(composerTarget()).toBe(beside);
    off.forEach((f) => f());
    expect(composerTarget()).toBeNull();
  });

  it('never goes to a composer behind another tab or hidden', () => {
    const main = composer();
    const beside = composer();
    const off = [registerComposer(main), registerComposer(beside)];
    noteComposerFocus(beside);
    beside.state.inert = true;
    expect(composerTarget()).toBe(main);
    beside.state.inert = false;
    main.state.shown = false;
    expect(composerTarget()).toBe(beside);
    noteComposerFocus(main);
    expect(composerTarget()).toBe(beside);
    off.forEach((f) => f());
  });

  it('forgets a composer once it unmounts, and tells listeners about changes', () => {
    const main = composer();
    const beside = composer();
    let calls = 0;
    const stop = subscribeComposers(() => { calls += 1; });
    const offMain = registerComposer(main);
    const offBeside = registerComposer(beside);
    noteComposerFocus(beside);
    noteComposerFocus(beside);
    expect(calls).toBe(3);
    expect(isComposerElement(beside.el)).toBe(true);
    offBeside();
    expect(isComposerElement(beside.el)).toBe(false);
    expect(composerTarget()).toBe(main);
    offMain();
    stop();
  });
});

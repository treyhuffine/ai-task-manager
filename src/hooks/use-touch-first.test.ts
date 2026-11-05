import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { TOUCH_FIRST_QUERY, useTouchFirst } from './use-touch-first';

/** A media query the test can flip, as connecting a trackpad to a tablet would. */
function fakeMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const asked: string[] = [];
  const list = {
    matches: initial,
    addEventListener: (_type: 'change', listener: () => void) => { listeners.add(listener); },
    removeEventListener: (_type: 'change', listener: () => void) => { listeners.delete(listener); },
  };
  return {
    matchMedia: (query: string) => {
      asked.push(query);
      return list;
    },
    asked,
    listeners,
    set(matches: boolean) {
      list.matches = matches;
      for (const listener of listeners) listener();
    },
  };
}

let root: Root;
let seen: boolean[];

function Probe() {
  const touchFirst = useTouchFirst();
  useLayoutEffect(() => { seen.push(touchFirst); });
  return null;
}

beforeEach(() => {
  const { window, document } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.getElementById('root') as unknown as HTMLElement);
  seen = [];
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

function mount(media: ReturnType<typeof fakeMedia>) {
  Object.assign(window, { matchMedia: media.matchMedia });
  act(() => root.render(createElement(Probe)));
}

describe('useTouchFirst', () => {
  it('asks for a main pointer that is coarse and cannot hover, not for a width', () => {
    expect(TOUCH_FIRST_QUERY).toBe('(hover: none) and (pointer: coarse)');
    const media = fakeMedia(true);
    mount(media);
    expect(media.asked.length).toBeGreaterThan(0);
    expect(new Set(media.asked)).toEqual(new Set([TOUCH_FIRST_QUERY]));
  });

  it('is true on a phone or a tablet on its own', () => {
    mount(fakeMedia(true));
    expect(seen.at(-1)).toBe(true);
  });

  it('is false on a computer, and on a tablet with a trackpad', () => {
    mount(fakeMedia(false));
    expect(seen.at(-1)).toBe(false);
  });

  it('follows the device as it changes, and stops listening once unmounted', () => {
    const media = fakeMedia(true);
    mount(media);
    expect(seen.at(-1)).toBe(true);
    // A trackpad connected: a fine pointer that hovers.
    act(() => media.set(false));
    expect(seen.at(-1)).toBe(false);
    act(() => media.set(true));
    expect(seen.at(-1)).toBe(true);
    expect(media.listeners.size).toBe(1);
    act(() => root.unmount());
    expect(media.listeners.size).toBe(0);
    root = createRoot(document.getElementById('root') as unknown as HTMLElement);
  });

  it('is false while rendering on the server, where the device is unknown', () => {
    Object.assign(window, { matchMedia: fakeMedia(true).matchMedia });
    const Read = () => createElement('span', null, String(useTouchFirst()));
    expect(renderToString(createElement(Read))).toBe('<span>false</span>');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { useEnterTransition } from './use-enter-transition';

let root: Root;
let entered: boolean;
let frames: Map<number, FrameRequestCallback>;

function Panel({ open }: { open: boolean }) {
  const value = useEnterTransition(open);
  useLayoutEffect(() => { entered = value; });
  return null;
}

const render = (open: boolean) => act(() => root.render(createElement(Panel, { open })));

/** Runs the frames requested so far, as the browser would on its next paint. */
const nextFrame = () => act(() => {
  const due = [...frames.values()];
  frames.clear();
  for (const callback of due) callback(0);
});

beforeEach(() => {
  const { window, document } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  frames = new Map();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => { frames.delete(handle); });
  root = createRoot(document.getElementById('root') as unknown as HTMLElement);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe('useEnterTransition', () => {
  it('turns true two frames after opening, so the panel paints closed first', () => {
    render(true);
    expect(entered).toBe(false);
    nextFrame();
    expect(entered).toBe(false);
    nextFrame();
    expect(entered).toBe(true);
  });

  it('stays false while closed and resets on close for the next opening', () => {
    render(false);
    nextFrame();
    expect(entered).toBe(false);

    render(true);
    nextFrame();
    nextFrame();
    expect(entered).toBe(true);

    render(false);
    expect(entered).toBe(false);

    render(true);
    expect(entered).toBe(false);
    nextFrame();
    nextFrame();
    expect(entered).toBe(true);
  });

  it('cancels the frames still pending when the panel closes first', () => {
    render(true);
    nextFrame();
    render(false);
    expect(frames.size).toBe(0);
    nextFrame();
    expect(entered).toBe(false);
  });
});

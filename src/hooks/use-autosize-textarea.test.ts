import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { useAutosizeTextarea } from './use-autosize-textarea';

type Handle = ReturnType<typeof useAutosizeTextarea>;

let root: Root | undefined;
let container: HTMLElement;
let handle: Handle;
let supportsFieldSizing: boolean;
let observers: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[];

/**
 * Mirrors the task slideout: the component is always mounted, but the title
 * textarea only renders once a task is open and loaded.
 */
function LateTitle({ ready, value, expose }: { ready: boolean; value?: string; expose: (h: Handle) => void }) {
  const autosize = useAutosizeTextarea(value);
  useLayoutEffect(() => expose(autosize));
  return ready ? createElement('textarea', { ref: autosize.ref, rows: 1, defaultValue: 'A long title' }) : null;
}

function render(props: { ready: boolean; value?: string }) {
  act(() => root!.render(createElement(LateTitle, { ...props, expose: (h: Handle) => { handle = h; } })));
}

function textarea() {
  return container.querySelector('textarea') as HTMLTextAreaElement;
}

/** linkedom has no layout engine, so give the field a measured content height. */
function withContentHeight(px: number) {
  Object.defineProperty(textarea(), 'scrollHeight', { configurable: true, get: () => px });
}

beforeEach(() => {
  const { window, document } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  supportsFieldSizing = true;
  vi.stubGlobal('CSS', { supports: (property: string, value: string) => supportsFieldSizing && property === 'field-sizing' && value === 'content' });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  observers = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor() {
        observers.push(this);
      }
    },
  );
  container = document.getElementById('root') as unknown as HTMLElement;
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});

describe('useAutosizeTextarea with native field-sizing', () => {
  it('enables field-sizing on a textarea that mounts after its component', () => {
    render({ ready: false });
    expect(textarea()).toBeNull();

    render({ ready: true });

    expect(textarea().style.getPropertyValue('field-sizing')).toBe('content');
    expect(handle.element.current).toBe(textarea());
  });

  it('never writes an inline height, which would override field-sizing and clip the title', () => {
    render({ ready: true });
    withContentHeight(120);

    act(() => handle.resize());

    expect(textarea().style.height).toBe('');
  });
});

describe('useAutosizeTextarea fallback (no field-sizing)', () => {
  beforeEach(() => {
    supportsFieldSizing = false;
  });

  it('sizes a late-mounted textarea to its content on attach', () => {
    render({ ready: false });
    // The first fit runs inside the ref callback, so the height getter must
    // exist before the element attaches.
    const proto = window.HTMLTextAreaElement.prototype;
    Object.defineProperty(proto, 'scrollHeight', { configurable: true, get: () => 96 });

    try {
      render({ ready: true });

      expect(textarea().style.getPropertyValue('field-sizing')).toBe('');
      expect(textarea().style.height).toBe('96px');
    } finally {
      delete (proto as { scrollHeight?: number }).scrollHeight;
    }
  });

  it('refits on resize() and on controlled value changes', () => {
    render({ ready: true, value: 'short' });
    withContentHeight(64);

    act(() => handle.resize());
    expect(textarea().style.height).toBe('64px');

    withContentHeight(128);
    render({ ready: true, value: 'a much longer value that wraps' });
    expect(textarea().style.height).toBe('128px');
  });

  it('watches width changes while attached and stops when the field unmounts', () => {
    render({ ready: true });
    expect(observers).toHaveLength(1);
    expect(observers[0].observe).toHaveBeenCalledWith(textarea());

    render({ ready: false });

    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(handle.element.current).toBeNull();
  });
});

'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Native `field-sizing: content` (Chromium 123+, so Electron and Chrome) lets
 * the browser grow a textarea to its content on every layout pass, including
 * each time it is re-shown, with zero JS. Checked at attach time rather than
 * module load so SSR and tests see the real runtime.
 */
function supportsFieldSizing(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('field-sizing', 'content')
  );
}

function fitToContent(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

/**
 * Grows a `<textarea>` to fit its content so titles wrap and expand downward
 * (Notion-style) instead of hiding behind `overflow-hidden`.
 *
 * Pass `ref` to the textarea (`ref={ref}`) and read the element through
 * `element.current`. The field should render with `rows={1}`, `resize-none`,
 * and `overflow-hidden`.
 *
 * Setup runs when the TEXTAREA attaches, not when the calling component mounts.
 * That distinction is the whole point: the task slideout is always mounted but
 * renders its title only once a task is open and loaded (and only in the doc
 * view), so a component-mount effect sees no element, bails, and never runs
 * again, leaving the title stuck on one line. A callback ref fires every time
 * the element appears, however late.
 *
 * Two strategies, native first:
 *  1. Where `field-sizing: content` is supported we set it and stop. The browser
 *     sizes the field on every layout, so a field opened already-full is right
 *     on the first frame and grows as you type. Never set an inline `height` in
 *     this mode: an explicit height overrides `field-sizing` and clips the text.
 *  2. Otherwise we measure `scrollHeight`: on attach, on the next frame (after
 *     any open animation settles), once fonts load, on width changes via
 *     ResizeObserver (rewrapping changes the line count), on every `resize()`
 *     the caller fires, and on controlled `value` changes.
 *
 * Pass `value` for a controlled field. Omit it for an uncontrolled field that
 * manages its own value via `element`/`defaultValue` and calls `resize()` on
 * input or after writing `.value`.
 */
export function useAutosizeTextarea(value?: string) {
  const element = useRef<HTMLTextAreaElement | null>(null);

  const resize = useCallback(() => {
    const el = element.current;
    if (!el || supportsFieldSizing()) return; // native mode sizes itself
    fitToContent(el);
  }, []);

  const ref = useCallback((el: HTMLTextAreaElement | null) => {
    element.current = el;
    if (!el) return;

    if (supportsFieldSizing()) {
      el.style.setProperty('field-sizing', 'content');
      return () => {
        element.current = null;
      };
    }

    fitToContent(el);
    let attached = true;
    const raf = requestAnimationFrame(() => fitToContent(el));
    document.fonts?.ready
      .then(() => {
        if (attached) fitToContent(el);
      })
      .catch(() => {});

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      let lastWidth = el.clientWidth;
      observer = new ResizeObserver(() => {
        // Height-only changes are our own writes; refitting on them would loop.
        if (el.clientWidth === lastWidth) return;
        lastWidth = el.clientWidth;
        fitToContent(el);
      });
      observer.observe(el);
    }

    return () => {
      attached = false;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      element.current = null;
    };
  }, []);

  // Controlled fields: refit when the value changes (no-op in native mode).
  useLayoutEffect(() => {
    resize();
  }, [value, resize]);

  return { ref, element, resize };
}

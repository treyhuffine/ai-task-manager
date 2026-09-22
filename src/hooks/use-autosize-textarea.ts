'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Native `field-sizing: content` (Chromium 123+, and what `ui/textarea.tsx`
 * already relies on) lets the browser grow a textarea to its content on every
 * layout pass — including each time it is re-shown — with zero JS. Detected once.
 */
const SUPPORTS_FIELD_SIZING =
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('field-sizing', 'content');

/**
 * Grows a `<textarea>` to fit its content so titles wrap and expand downward
 * (Notion-style) instead of hiding behind `overflow-hidden`.
 *
 * The field must render with `rows={1}`, `resize-none`, and `overflow-hidden`.
 *
 * Two strategies, native first:
 *  1. Where `field-sizing: content` is supported we set it and stop. The browser
 *     then sizes the field on every layout, so a field opened already-full (e.g.
 *     a slideout re-mounting an existing note) is correct on the first frame.
 *     This is the fix for "grows while typing but shows one line on reopen": a JS
 *     `scrollHeight` read taken while the panel is still animating in, or before
 *     web fonts load, measures a stale height exactly on open.
 *  2. Otherwise we fall back to measuring `scrollHeight`: on mount, on the next
 *     frame (after any open animation settles), once fonts load, on every
 *     `resize()` the caller fires, and on width changes via ResizeObserver.
 *
 * Pass `value` for a controlled field; omit it for an uncontrolled field that
 * manages its own value via `ref`/`defaultValue` and calls `resize()` on input.
 */
export function useAutosizeTextarea(value?: string) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el || SUPPORTS_FIELD_SIZING) return; // native handles sizing
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // Enable native sizing once, or (fallback) size on mount and controlled-value
  // change. useLayoutEffect runs before paint, so a full field never flashes
  // clipped.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (SUPPORTS_FIELD_SIZING) {
      el.style.setProperty('field-sizing', 'content');
      return;
    }

    resize();
    // A field mounted inside an opening/animating panel can measure a stale
    // width synchronously; re-measure once layout settles and once fonts load.
    const raf = requestAnimationFrame(resize);
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(resize).catch(() => {});
    }
    return () => cancelAnimationFrame(raf);
  }, [value, resize]);

  // Fallback only: re-size when the element's WIDTH changes (viewport, panel
  // open, sidebar toggle) since rewrapping alters the line count. Height-only
  // changes (our own writes) are ignored to avoid a ResizeObserver loop.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || SUPPORTS_FIELD_SIZING || typeof ResizeObserver === 'undefined') return;

    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      const width = ref.current?.clientWidth ?? lastWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      resize();
    });
    observer.observe(el);

    return () => observer.disconnect();
  }, [resize]);

  return { ref, resize };
}

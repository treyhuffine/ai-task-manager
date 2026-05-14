'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Layout } from 'react-resizable-panels';

/**
 * Per-session resizable-panel layouts for the execution view.
 * Persists to localStorage under `flow.execution.layout.<id>` and
 * `flow.execution.layout.vertical.<id>` so a user's preferred column
 * widths and viewer/terminal split survive reloads and navigation.
 *
 * Writes debounce by 300ms — react-resizable-panels fires `onLayoutChange`
 * during every drag frame; we don't want one drag to produce hundreds
 * of localStorage writes. (`onLayoutChanged` only fires on release, which
 * is also fine, but the debounced write keeps things uniform either way.)
 *
 * `Layout` is the shape react-resizable-panels speaks: `{ [panelId]: number }`.
 */

const STORAGE_PREFIX = 'flow.execution.layout';
const STORAGE_PREFIX_V = 'flow.execution.layout.vertical';
const STORAGE_PREFIX_TERM_OPEN = 'flow.execution.layout.terminalOpenPct';
const WRITE_DEBOUNCE_MS = 300;

export const HORIZONTAL_PANEL_IDS = {
  chat: 'exec-chat',
  tree: 'exec-tree',
  right: 'exec-right',
} as const;

export const VERTICAL_PANEL_IDS = {
  viewer: 'exec-viewer',
  terminal: 'exec-terminal',
} as const;

export const DEFAULT_HORIZONTAL: Layout = {
  [HORIZONTAL_PANEL_IDS.chat]: 40,
  [HORIZONTAL_PANEL_IDS.tree]: 18,
  [HORIZONTAL_PANEL_IDS.right]: 42,
};

export const DEFAULT_VERTICAL: Layout = {
  [VERTICAL_PANEL_IDS.viewer]: 70,
  [VERTICAL_PANEL_IDS.terminal]: 30,
};

export const DEFAULT_TERMINAL_OPEN_PCT = 30;

function readLayout(key: string, fallback: Layout): Layout {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
    // Validate that every key in fallback has a finite numeric value in parsed.
    for (const k of Object.keys(fallback)) {
      const v = (parsed as Record<string, unknown>)[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return fallback;
    }
    return parsed as Layout;
  } catch {
    return fallback;
  }
}

// Minimum percentage we'll accept as a saved "open" terminal height. Below
// this threshold the value is almost certainly corruption (the panel was
// rendered at the 32px tab-strip slice, not at a real open height) — fall
// back to the default so expand snaps to a useful size.
const MIN_OPEN_PCT = 8;

function readNumber(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const n = JSON.parse(raw);
    if (typeof n !== 'number' || !Number.isFinite(n) || n < MIN_OPEN_PCT) return fallback;
    return n;
  } catch {
    return fallback;
  }
}

export function useExecutionLayoutSizes(sessionId: string) {
  const horizontalKey = `${STORAGE_PREFIX}.${sessionId}`;
  const verticalKey = `${STORAGE_PREFIX_V}.${sessionId}`;
  const terminalOpenKey = `${STORAGE_PREFIX_TERM_OPEN}.${sessionId}`;

  const [horizontal, setHorizontalState] = useState<Layout>(() =>
    readLayout(horizontalKey, DEFAULT_HORIZONTAL),
  );
  const [vertical, setVerticalState] = useState<Layout>(() =>
    readLayout(verticalKey, DEFAULT_VERTICAL),
  );
  const [terminalOpenPct, setTerminalOpenPctState] = useState<number>(() =>
    readNumber(terminalOpenKey, DEFAULT_TERMINAL_OPEN_PCT),
  );

  // Re-read when the session id changes (user navigated between executions).
  useEffect(() => {
    setHorizontalState(readLayout(horizontalKey, DEFAULT_HORIZONTAL));
    setVerticalState(readLayout(verticalKey, DEFAULT_VERTICAL));
    setTerminalOpenPctState(readNumber(terminalOpenKey, DEFAULT_TERMINAL_OPEN_PCT));
  }, [horizontalKey, verticalKey, terminalOpenKey]);

  const hTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setHorizontal = useCallback(
    (next: Layout) => {
      setHorizontalState(next);
      if (hTimerRef.current) clearTimeout(hTimerRef.current);
      hTimerRef.current = setTimeout(() => {
        try {
          window.localStorage.setItem(horizontalKey, JSON.stringify(next));
        } catch {
          /* quota or unavailable — drop the write */
        }
      }, WRITE_DEBOUNCE_MS);
    },
    [horizontalKey],
  );

  const setVertical = useCallback(
    (next: Layout) => {
      setVerticalState(next);
      if (vTimerRef.current) clearTimeout(vTimerRef.current);
      vTimerRef.current = setTimeout(() => {
        try {
          window.localStorage.setItem(verticalKey, JSON.stringify(next));
        } catch {
          /* quota or unavailable — drop the write */
        }
      }, WRITE_DEBOUNCE_MS);
    },
    [verticalKey],
  );

  const setTerminalOpenPct = useCallback(
    (next: number) => {
      if (!Number.isFinite(next) || next < MIN_OPEN_PCT) return;
      setTerminalOpenPctState(next);
      if (tTimerRef.current) clearTimeout(tTimerRef.current);
      tTimerRef.current = setTimeout(() => {
        try {
          window.localStorage.setItem(terminalOpenKey, JSON.stringify(next));
        } catch {
          /* quota or unavailable — drop the write */
        }
      }, WRITE_DEBOUNCE_MS);
    },
    [terminalOpenKey],
  );

  useEffect(() => {
    return () => {
      if (hTimerRef.current) clearTimeout(hTimerRef.current);
      if (vTimerRef.current) clearTimeout(vTimerRef.current);
      if (tTimerRef.current) clearTimeout(tTimerRef.current);
    };
  }, []);

  return {
    horizontal,
    vertical,
    terminalOpenPct,
    setHorizontal,
    setVertical,
    setTerminalOpenPct,
  };
}

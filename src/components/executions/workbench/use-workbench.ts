'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  INITIAL_WORKBENCH,
  fromPersisted,
  toPersisted,
  workbenchReducer,
  type PanelView,
  type WorkbenchAction,
  type WorkbenchState,
} from './workbench-state';

const STATE_KEY = (id: string) => `ri.execution.workbench.${id}`;
const PANEL_WIDTH_KEY = 'ri.execution.workbench.panelPct';
const TERMINAL_HEIGHT_KEY = 'ri.execution.workbench.terminalPct';

export const DEFAULT_PANEL_PCT = 52;
export const DEFAULT_TERMINAL_PCT = 34;

function readJson(key: string): unknown {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: layout just won't persist */
  }
}

function readPct(key: string, fallback: number, min: number, max: number): number {
  const n = readJson(key);
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

export interface Workbench {
  state: WorkbenchState;
  dispatch: (action: WorkbenchAction) => void;
  show: (view: PanelView) => void;
  jump: (view: PanelView) => void;
  /**
   * True when `view` was opened by the user during this visit (so it may
   * take focus), false when it was restored from the last visit.
   */
  openedThisVisit: (view: PanelView) => boolean;
  panelPct: number;
  setPanelPct: (pct: number) => void;
  terminalPct: number;
  setTerminalPct: (pct: number) => void;
}

/**
 * Workbench state for one execution: which panel view is open, the back
 * pill, expand, and the terminal drawer. The durable parts persist per
 * execution, so coming back to an execution restores the panel as it was
 * left. The panel width and terminal height are global preferences.
 *
 * `worktreeId` is the execution id (or the chat's own id without one), so
 * hopping between chats on one execution keeps the same workbench.
 */
export function useWorkbench(worktreeId: string): Workbench {
  const [state, rawDispatch] = useReducer(workbenchReducer, worktreeId, (id) => fromPersisted(readJson(STATE_KEY(id))));
  const openedRef = useRef<Set<PanelView>>(new Set());

  // A different execution: load its own state instead of carrying this one's.
  const loadedIdRef = useRef(worktreeId);
  useEffect(() => {
    if (loadedIdRef.current === worktreeId) return;
    loadedIdRef.current = worktreeId;
    openedRef.current = new Set();
    rawDispatch({ type: 'reset', state: fromPersisted(readJson(STATE_KEY(worktreeId))) });
  }, [worktreeId]);

  // Persist the durable fields (skipping the render where the id just changed).
  useEffect(() => {
    if (loadedIdRef.current !== worktreeId) return;
    if (state === INITIAL_WORKBENCH) return;
    writeJson(STATE_KEY(worktreeId), toPersisted(state));
  }, [state, worktreeId]);

  const dispatch = useCallback((action: WorkbenchAction) => {
    if (action.type === 'show' || action.type === 'jump') openedRef.current.add(action.view);
    rawDispatch(action);
  }, []);
  const show = useCallback((view: PanelView) => dispatch({ type: 'show', view }), [dispatch]);
  const jump = useCallback((view: PanelView) => dispatch({ type: 'jump', view }), [dispatch]);
  const openedThisVisit = useCallback((view: PanelView) => openedRef.current.has(view), []);

  const [panelPct, setPanelPctState] = useState(() => readPct(PANEL_WIDTH_KEY, DEFAULT_PANEL_PCT, 25, 80));
  const [terminalPct, setTerminalPctState] = useState(() => readPct(TERMINAL_HEIGHT_KEY, DEFAULT_TERMINAL_PCT, 12, 80));
  const setPanelPct = useCallback((pct: number) => {
    setPanelPctState(pct);
    writeJson(PANEL_WIDTH_KEY, pct);
  }, []);
  const setTerminalPct = useCallback((pct: number) => {
    setTerminalPctState(pct);
    writeJson(TERMINAL_HEIGHT_KEY, pct);
  }, []);

  return { state, dispatch, show, jump, openedThisVisit, panelPct, setPanelPct, terminalPct, setTerminalPct };
}

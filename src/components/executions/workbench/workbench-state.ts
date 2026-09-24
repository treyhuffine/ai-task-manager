/**
 * Navigation state for the execution workbench: the right-hand panel and
 * its views, the "‹ Changes" back pill, expand, and the bottom terminal
 * drawer. A pure reducer so the rules are testable without React.
 *
 * The rules (see docs/execution-view-spec.md, "Workbench layout"):
 *   - Closed, a floating box lists the tools. Open, the same tools become
 *     the panel's views. Opening a view from the box or a tab is a peer
 *     switch and builds no history.
 *   - A jump (from the chat, or drilling from one view into another)
 *     remembers where you were, which drives the back pill.
 *   - The Tools toggle reopens the panel exactly as you left it. Reopening
 *     is a restore, so it never starts anything.
 *   - Escape restores an expanded panel first, then closes it. It never
 *     touches the terminal, which needs Escape for itself.
 *   - Hiding the terminal hides it. Shells keep running.
 */

export const PANEL_VIEWS = ['run', 'preview', 'changes', 'files', 'notes', 'scratch'] as const;
export type PanelView = (typeof PANEL_VIEWS)[number];

/** Views shown as tabs. The rest live in the panel's More menu. */
export const PRIMARY_VIEWS: readonly PanelView[] = ['run', 'preview', 'changes', 'files'];
export const MORE_VIEWS: readonly PanelView[] = ['notes', 'scratch'];

export const PANEL_VIEW_LABELS: Record<PanelView, string> = {
  run: 'Run',
  preview: 'Preview',
  changes: 'Changes',
  files: 'Files',
  notes: 'Notes & tasks',
  scratch: 'Scratchpad',
};

export function isPanelView(value: unknown): value is PanelView {
  return typeof value === 'string' && (PANEL_VIEWS as readonly string[]).includes(value);
}

export interface WorkbenchState {
  /** The open panel view, or null when the panel is closed (the box shows). */
  view: PanelView | null;
  /** What the Tools toggle reopens. */
  last: PanelView;
  /** Where a jump came from. Drives the back pill. */
  from: PanelView | null;
  /** The panel has the whole width and the chat folds to a strip. */
  maximized: boolean;
  terminalOpen: boolean;
  /** The terminal fills the execution area. */
  terminalMaximized: boolean;
}

export const INITIAL_WORKBENCH: WorkbenchState = {
  view: null,
  last: 'preview',
  from: null,
  maximized: false,
  terminalOpen: false,
  terminalMaximized: false,
};

export type WorkbenchAction =
  /** A tab, a box row, or the More menu: a peer switch with no history. */
  | { type: 'show'; view: PanelView }
  /** From the chat, or drilling from one view into another: remembers where you were. */
  | { type: 'jump'; view: PanelView }
  | { type: 'back' }
  | { type: 'close' }
  | { type: 'togglePanel' }
  | { type: 'toggleMaximize' }
  | { type: 'toggleTerminal' }
  | { type: 'toggleTerminalMaximize' }
  | { type: 'escape' }
  /** Replace the whole state, e.g. when switching to a different execution. */
  | { type: 'reset'; state: WorkbenchState };

export function workbenchReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case 'show':
      if (state.view === action.view && state.from === null) return state;
      return { ...state, view: action.view, last: action.view, from: null };

    case 'jump': {
      if (state.view === action.view) return state;
      return { ...state, view: action.view, last: action.view, from: state.view };
    }

    case 'back':
      if (!state.from) return state;
      return { ...state, view: state.from, last: state.from, from: null };

    case 'close':
      if (state.view === null && !state.maximized) return state;
      return { ...state, view: null, from: null, maximized: false };

    case 'togglePanel':
      return state.view
        ? { ...state, view: null, from: null, maximized: false }
        : { ...state, view: state.last };

    case 'toggleMaximize':
      if (!state.view) return state;
      return { ...state, maximized: !state.maximized };

    case 'toggleTerminal':
      return { ...state, terminalOpen: !state.terminalOpen, terminalMaximized: false };

    case 'toggleTerminalMaximize':
      if (!state.terminalOpen) return state;
      return { ...state, terminalMaximized: !state.terminalMaximized };

    case 'escape':
      if (state.maximized) return { ...state, maximized: false };
      if (state.view) return { ...state, view: null, from: null };
      return state;

    case 'reset':
      return action.state;
  }
}

/** The fields worth keeping across reloads, per execution. */
export interface PersistedWorkbench {
  view: PanelView | null;
  last: PanelView;
  terminalOpen: boolean;
}

export function toPersisted(state: WorkbenchState): PersistedWorkbench {
  return { view: state.view, last: state.last, terminalOpen: state.terminalOpen };
}

/**
 * Rebuild state from whatever was stored. Anything malformed falls back to
 * the initial state field by field, so a stale or hand-edited entry can
 * never wedge the view.
 */
export function fromPersisted(raw: unknown): WorkbenchState {
  if (!raw || typeof raw !== 'object') return INITIAL_WORKBENCH;
  const r = raw as Record<string, unknown>;
  return {
    ...INITIAL_WORKBENCH,
    view: isPanelView(r.view) ? r.view : null,
    last: isPanelView(r.last) ? r.last : INITIAL_WORKBENCH.last,
    terminalOpen: r.terminalOpen === true,
  };
}

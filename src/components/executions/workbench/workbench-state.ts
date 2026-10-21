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
 *   - A file opened from the chat is one more view, `file`, shown as its own
 *     tab while it's open (docs/chat-sessions.md, "Files beside the chat").
 *     Opening it is a jump, so closing it goes back where you were.
 */

export const PANEL_VIEWS = ['run', 'preview', 'changes', 'files', 'notes', 'scratch', 'file'] as const;
export type PanelView = (typeof PANEL_VIEWS)[number];
/** The panel's own tools: every view but the file opened from the chat. */
export type ToolView = Exclude<PanelView, 'file'>;

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
  file: 'File',
};

export function isPanelView(value: unknown): value is PanelView {
  return typeof value === 'string' && (PANEL_VIEWS as readonly string[]).includes(value);
}

function isToolView(value: unknown): value is ToolView {
  return isPanelView(value) && value !== 'file';
}

export interface WorkbenchState {
  /** The open panel view, or null when the panel is closed (the box shows). */
  view: PanelView | null;
  /** What the Tools toggle reopens. */
  last: PanelView;
  /** Where a jump came from. Drives the back pill. */
  from: PanelView | null;
  /** The last tool shown (never the file): what `last` becomes once the file closes. */
  tool: ToolView;
  /** What the file came forward over: the tool showing then, or null with the
   *  panel closed. Closing the file goes back to it. Hiding and restoring the
   *  panel keeps it, where it clears `from`. */
  covered: ToolView | null;
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
  tool: 'preview',
  covered: null,
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
  /** The file beside the chat closed, or isn't there (gone after a reload): leave its view. */
  | { type: 'fileClosed' }
  /** Replace the whole state, e.g. when switching to a different execution. */
  | { type: 'reset'; state: WorkbenchState };

export function workbenchReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case 'show':
      if (state.view === action.view && state.from === null) return state;
      return { ...state, view: action.view, last: action.view, from: null, tool: toolAfter(state, action.view), covered: coveredAfter(state, action.view) };

    case 'jump': {
      if (state.view === action.view) return state;
      return { ...state, view: action.view, last: action.view, from: state.view, tool: toolAfter(state, action.view), covered: coveredAfter(state, action.view) };
    }

    case 'back':
      if (!state.from) return state;
      return { ...state, view: state.from, last: state.from, from: null, tool: toolAfter(state, state.from) };

    case 'fileClosed': {
      const last = state.last === 'file' ? state.tool : state.last;
      if (state.view !== 'file') {
        // Jumped from the file into another view: there's no file to go back to.
        const from = state.from === 'file' ? null : state.from;
        if (last === state.last && from === state.from && state.covered === null) return state;
        return { ...state, last, from, covered: null };
      }
      // Back to the tool it came forward over, or closed if the panel was.
      const view = state.covered;
      return { ...state, view, from: null, last: view ?? last, covered: null, maximized: view ? state.maximized : false };
    }

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

function toolAfter(state: WorkbenchState, view: PanelView): ToolView {
  return isToolView(view) ? view : state.tool;
}

/** Bringing the file forward remembers the tool it covers. Any other view leaves it be. */
function coveredAfter(state: WorkbenchState, view: PanelView): ToolView | null {
  if (view !== 'file') return state.covered;
  return state.view === 'file' ? state.covered : state.view;
}

/** The fields worth keeping across reloads, per execution. With the file
 * open, what it covered too, so coming back finds the file, or (the file
 * gone with the page) the tool under it. */
export interface PersistedWorkbench {
  view: PanelView | null;
  last: PanelView;
  tool: ToolView;
  covered?: ToolView | null;
  terminalOpen: boolean;
}

export function toPersisted(state: WorkbenchState): PersistedWorkbench {
  return {
    view: state.view,
    last: state.last,
    tool: state.tool,
    ...(state.view === 'file' || state.last === 'file' ? { covered: state.covered } : {}),
    terminalOpen: state.terminalOpen,
  };
}

/**
 * Rebuild state from whatever was stored. Anything malformed falls back to
 * the initial state field by field, so a stale or hand-edited entry can
 * never wedge the view.
 */
export function fromPersisted(raw: unknown): WorkbenchState {
  if (!raw || typeof raw !== 'object') return INITIAL_WORKBENCH;
  const r = raw as Record<string, unknown>;
  const view = isPanelView(r.view) ? r.view : null;
  const last = isPanelView(r.last) ? r.last : INITIAL_WORKBENCH.last;
  return {
    ...INITIAL_WORKBENCH,
    view,
    last,
    covered: (view === 'file' || last === 'file') && isToolView(r.covered) ? r.covered : null,
    tool: isToolView(r.tool) ? r.tool : isToolView(last) ? last : INITIAL_WORKBENCH.tool,
    terminalOpen: r.terminalOpen === true,
  };
}

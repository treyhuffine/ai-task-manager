/**
 * Layout state for one agent's view: the tools panel (open, expanded) and
 * the terminal drawer. The same rules as an execution's workbench
 * (`executions/workbench/workbench-state.ts`), without its panel views,
 * since the agent's tools are its own tabs (`agent-tools.tsx`, with the tab
 * kept in `agent-view-tab.ts`). A pure reducer so the rules are testable
 * without React. docs/agents-view-spec.md §10.
 *
 *   - The Tools toggle shows or hides the panel, as left. Hiding it never
 *     unmounts it, so a chat beside keeps its draft and a page its scroll.
 *   - A file or a chat opened beside the main chat opens closed tools for
 *     itself, and closes them again once both are put away, unless the tools
 *     were used by hand meanwhile (the toggle, a box row, a tab picked).
 *   - Escape restores an expanded panel first, then closes it. It never
 *     touches the terminal, which needs Escape for itself.
 *   - Hiding the terminal hides it. Shells keep running.
 *   - Tools and terminal open or closed persist per agent. Expanded doesn't,
 *     as an execution's doesn't.
 */

export interface AgentLayoutState {
  toolsOpen: boolean;
  /** The tools have the whole width and the main chat folds to a strip. */
  maximized: boolean;
  /** The tools opened on their own, for a file or a chat beside, not by hand. */
  openedForBeside: boolean;
  terminalOpen: boolean;
  /** The terminal fills the view below the header. */
  terminalMaximized: boolean;
}

export const INITIAL_AGENT_LAYOUT: AgentLayoutState = {
  toolsOpen: true,
  maximized: false,
  openedForBeside: false,
  terminalOpen: false,
  terminalMaximized: false,
};

export type AgentLayoutAction =
  /** The Tools toggle or ⌃. */
  | { type: 'toggleTools' }
  /** By hand, onto a tool: a box row, ⌘P. */
  | { type: 'openTools' }
  /** The panel's ×. */
  | { type: 'closeTools' }
  /** A file or a chat came forward beside the main chat. */
  | { type: 'openForBeside' }
  /** The file and the chat beside are both put away. */
  | { type: 'besideGone' }
  /** A tool tab was picked, here or through the URL: the tools are in use. */
  | { type: 'toolPicked' }
  | { type: 'toggleMaximize' }
  | { type: 'toggleTerminal' }
  | { type: 'toggleTerminalMaximize' }
  | { type: 'escape' }
  /** Replace the whole state: another agent's, loaded. */
  | { type: 'reset'; state: AgentLayoutState };

const closed = (state: AgentLayoutState): AgentLayoutState => ({ ...state, toolsOpen: false, maximized: false, openedForBeside: false });

export function agentLayoutReducer(state: AgentLayoutState, action: AgentLayoutAction): AgentLayoutState {
  switch (action.type) {
    case 'toggleTools':
      return state.toolsOpen ? closed(state) : { ...state, toolsOpen: true, openedForBeside: false };

    case 'openTools':
      if (state.toolsOpen && !state.openedForBeside) return state;
      return { ...state, toolsOpen: true, openedForBeside: false };

    case 'closeTools':
      if (!state.toolsOpen) return state;
      return closed(state);

    case 'openForBeside':
      if (state.toolsOpen) return state;
      return { ...state, toolsOpen: true, openedForBeside: true };

    case 'besideGone':
      if (!state.openedForBeside) return state;
      return closed(state);

    case 'toolPicked':
      if (!state.openedForBeside) return state;
      return { ...state, openedForBeside: false };

    case 'toggleMaximize':
      if (!state.toolsOpen) return state;
      return { ...state, maximized: !state.maximized };

    case 'toggleTerminal':
      return { ...state, terminalOpen: !state.terminalOpen, terminalMaximized: false };

    case 'toggleTerminalMaximize':
      if (!state.terminalOpen) return state;
      return { ...state, terminalMaximized: !state.terminalMaximized };

    case 'escape':
      if (state.maximized) return { ...state, maximized: false };
      if (state.toolsOpen) return closed(state);
      return state;

    case 'reset':
      return action.state;
  }
}

/** What's kept across reloads, per agent. Tools opened only for a file or chat beside count as closed. */
export interface PersistedAgentLayout {
  toolsOpen: boolean;
  terminalOpen: boolean;
}

export function toPersisted(state: AgentLayoutState): PersistedAgentLayout {
  return { toolsOpen: state.toolsOpen && !state.openedForBeside, terminalOpen: state.terminalOpen };
}

/**
 * Rebuild state from whatever was stored, field by field, so a stale or
 * hand-edited entry can never wedge the view. `toolsOpen` is the default
 * for an agent with nothing stored.
 */
export function fromPersisted(raw: unknown, toolsOpen: boolean): AgentLayoutState {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    ...INITIAL_AGENT_LAYOUT,
    toolsOpen: typeof r.toolsOpen === 'boolean' ? r.toolsOpen : toolsOpen,
    terminalOpen: r.terminalOpen === true,
  };
}

/**
 * The one layout every agent shared before the tools had a state of their
 * own (react-resizable-panels' `{ "agent-chat": 42, "agent-tools": 58 }`,
 * in %). Its tools width becomes the starting width, and its collapsed tools
 * the default for agents with nothing stored, so nobody's layout changes
 * under them.
 */
export function fromLegacyLayout(raw: unknown): { toolsOpen?: boolean; toolsPct?: number } {
  if (!raw || typeof raw !== 'object') return {};
  const tools = (raw as Record<string, unknown>)['agent-tools'];
  if (typeof tools !== 'number' || !Number.isFinite(tools)) return {};
  return {
    toolsOpen: tools > 0,
    ...(tools >= 25 && tools <= 80 ? { toolsPct: tools } : {}),
  };
}

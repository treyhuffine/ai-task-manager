import { describe, it, expect } from 'vitest';
import {
  INITIAL_AGENT_LAYOUT,
  agentLayoutReducer,
  fromLegacyLayout,
  fromPersisted,
  toPersisted,
  type AgentLayoutAction,
  type AgentLayoutState,
} from './agent-layout';

const run = (actions: AgentLayoutAction[], start: AgentLayoutState = INITIAL_AGENT_LAYOUT) =>
  actions.reduce(agentLayoutReducer, start);
const closedTools: AgentLayoutState = { ...INITIAL_AGENT_LAYOUT, toolsOpen: false };

describe('agentLayoutReducer', () => {
  it('the Tools toggle hides and shows the panel', () => {
    expect(run([{ type: 'toggleTools' }]).toolsOpen).toBe(false);
    expect(run([{ type: 'toggleTools' }, { type: 'toggleTools' }]).toolsOpen).toBe(true);
  });

  it('hiding an expanded panel brings the chat back for next time', () => {
    const s = run([{ type: 'toggleMaximize' }, { type: 'toggleTools' }]);
    expect(s).toMatchObject({ toolsOpen: false, maximized: false });
    expect(agentLayoutReducer(s, { type: 'toggleTools' }).maximized).toBe(false);
  });

  it('expands only while open', () => {
    expect(run([{ type: 'toggleMaximize' }], closedTools).maximized).toBe(false);
    expect(run([{ type: 'toggleMaximize' }]).maximized).toBe(true);
  });

  it('Escape restores an expanded panel first, then closes it, and never touches the terminal', () => {
    const start = run([{ type: 'toggleTerminal' }, { type: 'toggleMaximize' }]);
    const once = agentLayoutReducer(start, { type: 'escape' });
    expect(once).toMatchObject({ toolsOpen: true, maximized: false, terminalOpen: true });
    const twice = agentLayoutReducer(once, { type: 'escape' });
    expect(twice).toMatchObject({ toolsOpen: false, terminalOpen: true });
    expect(agentLayoutReducer(twice, { type: 'escape' })).toBe(twice);
  });

  it('the panel × closes it', () => {
    expect(run([{ type: 'closeTools' }]).toolsOpen).toBe(false);
    expect(run([{ type: 'closeTools' }], closedTools)).toBe(closedTools);
  });

  it('toggling the terminal hides it unexpanded, and expand only works while it shows', () => {
    const open = run([{ type: 'toggleTerminal' }, { type: 'toggleTerminalMaximize' }]);
    expect(open).toMatchObject({ terminalOpen: true, terminalMaximized: true });
    const hidden = agentLayoutReducer(open, { type: 'toggleTerminal' });
    expect(hidden).toMatchObject({ terminalOpen: false, terminalMaximized: false });
    expect(agentLayoutReducer(hidden, { type: 'toggleTerminalMaximize' })).toBe(hidden);
    expect(agentLayoutReducer(hidden, { type: 'toggleTerminal' }).terminalMaximized).toBe(false);
  });

  it('the terminal and the tools are independent', () => {
    const s = run([{ type: 'toggleTerminal' }, { type: 'toggleTools' }]);
    expect(s).toMatchObject({ terminalOpen: true, toolsOpen: false });
  });

  describe('a file or a chat beside the main chat', () => {
    it('opens closed tools for itself, and closes them when it goes', () => {
      const s = run([{ type: 'openForBeside' }], closedTools);
      expect(s).toMatchObject({ toolsOpen: true, openedForBeside: true });
      expect(agentLayoutReducer(s, { type: 'besideGone' })).toMatchObject({ toolsOpen: false, openedForBeside: false });
    });

    it('leaves open tools as they are, and leaves them open when it goes', () => {
      const s = run([{ type: 'openForBeside' }, { type: 'besideGone' }]);
      expect(s).toBe(INITIAL_AGENT_LAYOUT);
    });

    it('keeps the tools open once they are used by hand meanwhile', () => {
      for (const byHand of [{ type: 'toolPicked' }, { type: 'openTools' }] as const) {
        const s = run([{ type: 'openForBeside' }, byHand, { type: 'besideGone' }], closedTools);
        expect(s, byHand.type).toMatchObject({ toolsOpen: true, openedForBeside: false });
      }
    });

    it('the toggle after opening for it is a hand-made close, and a reopen is by hand', () => {
      const s = run([{ type: 'openForBeside' }, { type: 'toggleTools' }, { type: 'toggleTools' }, { type: 'besideGone' }], closedTools);
      expect(s.toolsOpen).toBe(true);
    });
  });
});

describe('persistence', () => {
  it('keeps the tools and the terminal, per agent, and never expanded', () => {
    const s = run([{ type: 'toggleTerminal' }, { type: 'toggleTerminalMaximize' }, { type: 'toggleMaximize' }]);
    expect(toPersisted(s)).toEqual({ toolsOpen: true, terminalOpen: true });
    expect(fromPersisted(toPersisted(s), true)).toEqual({ ...INITIAL_AGENT_LAYOUT, terminalOpen: true });
  });

  it('tools opened only for a file or chat beside are stored as closed', () => {
    const s = run([{ type: 'openForBeside' }], closedTools);
    expect(toPersisted(s).toolsOpen).toBe(false);
  });

  it('falls back field by field, with the given default for the tools', () => {
    expect(fromPersisted(null, true)).toEqual(INITIAL_AGENT_LAYOUT);
    expect(fromPersisted(null, false)).toEqual(closedTools);
    expect(fromPersisted({ toolsOpen: 'yes', terminalOpen: 1 }, false)).toEqual(closedTools);
    expect(fromPersisted({ toolsOpen: false }, true)).toEqual(closedTools);
  });
});

describe('fromLegacyLayout', () => {
  it('reads the width and collapsed tools of the layout every agent shared', () => {
    expect(fromLegacyLayout({ 'agent-chat': 40, 'agent-tools': 60 })).toEqual({ toolsOpen: true, toolsPct: 60 });
    expect(fromLegacyLayout({ 'agent-chat': 100, 'agent-tools': 0 })).toEqual({ toolsOpen: false });
  });

  it('ignores a width the panel can no longer take, and anything malformed', () => {
    expect(fromLegacyLayout({ 'agent-chat': 10, 'agent-tools': 90 })).toEqual({ toolsOpen: true });
    expect(fromLegacyLayout(null)).toEqual({});
    expect(fromLegacyLayout({ 'agent-tools': '58' })).toEqual({});
  });
});

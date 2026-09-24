import { describe, it, expect } from 'vitest';
import {
  INITIAL_WORKBENCH,
  fromPersisted,
  toPersisted,
  workbenchReducer,
  type WorkbenchAction,
  type WorkbenchState,
} from './workbench-state';

const run = (actions: WorkbenchAction[], start: WorkbenchState = INITIAL_WORKBENCH) =>
  actions.reduce(workbenchReducer, start);

describe('workbenchReducer', () => {
  it('opens a view from the box or a tab without building history', () => {
    const s = run([{ type: 'show', view: 'preview' }, { type: 'show', view: 'changes' }]);
    expect(s.view).toBe('changes');
    expect(s.from).toBeNull();
    expect(s.last).toBe('changes');
  });

  it('a jump remembers where you were, and back returns there', () => {
    const s = run([{ type: 'show', view: 'changes' }, { type: 'jump', view: 'files' }]);
    expect(s).toMatchObject({ view: 'files', from: 'changes' });
    const back = workbenchReducer(s, { type: 'back' });
    expect(back).toMatchObject({ view: 'changes', from: null, last: 'changes' });
  });

  it('a jump from a closed panel has nothing to go back to', () => {
    const s = run([{ type: 'jump', view: 'files' }]);
    expect(s).toMatchObject({ view: 'files', from: null });
  });

  it('a peer switch after a jump clears the back pill', () => {
    const s = run([{ type: 'show', view: 'changes' }, { type: 'jump', view: 'files' }, { type: 'show', view: 'run' }]);
    expect(s.from).toBeNull();
  });

  it('the Tools toggle reopens the panel as it was left', () => {
    const s = run([{ type: 'show', view: 'changes' }, { type: 'togglePanel' }]);
    expect(s.view).toBeNull();
    expect(workbenchReducer(s, { type: 'togglePanel' }).view).toBe('changes');
  });

  it('the Tools toggle opens Preview the first time', () => {
    expect(run([{ type: 'togglePanel' }]).view).toBe('preview');
  });

  it('closing the panel also ends expand and the back pill', () => {
    const s = run([{ type: 'show', view: 'changes' }, { type: 'jump', view: 'files' }, { type: 'toggleMaximize' }, { type: 'close' }]);
    expect(s).toMatchObject({ view: null, from: null, maximized: false });
  });

  it('expand only applies with a panel open', () => {
    expect(run([{ type: 'toggleMaximize' }]).maximized).toBe(false);
    expect(run([{ type: 'show', view: 'preview' }, { type: 'toggleMaximize' }]).maximized).toBe(true);
  });

  it('Escape restores an expanded panel first, then closes it', () => {
    const expanded = run([{ type: 'show', view: 'preview' }, { type: 'toggleMaximize' }]);
    const restored = workbenchReducer(expanded, { type: 'escape' });
    expect(restored).toMatchObject({ view: 'preview', maximized: false });
    expect(workbenchReducer(restored, { type: 'escape' }).view).toBeNull();
  });

  it('Escape never touches the terminal', () => {
    const s = run([{ type: 'toggleTerminal' }, { type: 'escape' }, { type: 'escape' }]);
    expect(s.terminalOpen).toBe(true);
  });

  it('hiding the terminal also ends its expand', () => {
    const s = run([{ type: 'toggleTerminal' }, { type: 'toggleTerminalMaximize' }, { type: 'toggleTerminal' }]);
    expect(s).toMatchObject({ terminalOpen: false, terminalMaximized: false });
  });

  it('the terminal can only expand while open', () => {
    expect(run([{ type: 'toggleTerminalMaximize' }]).terminalMaximized).toBe(false);
  });

  it('returns the same object for no-op actions so React can skip renders', () => {
    const s = run([{ type: 'show', view: 'run' }]);
    expect(workbenchReducer(s, { type: 'show', view: 'run' })).toBe(s);
    expect(workbenchReducer(INITIAL_WORKBENCH, { type: 'close' })).toBe(INITIAL_WORKBENCH);
    expect(workbenchReducer(INITIAL_WORKBENCH, { type: 'back' })).toBe(INITIAL_WORKBENCH);
  });
});

describe('persistence', () => {
  it('round-trips the durable fields only', () => {
    const s = run([{ type: 'show', view: 'changes' }, { type: 'jump', view: 'files' }, { type: 'toggleMaximize' }, { type: 'toggleTerminal' }]);
    const restored = fromPersisted(JSON.parse(JSON.stringify(toPersisted(s))));
    expect(restored).toMatchObject({ view: 'files', last: 'files', terminalOpen: true, from: null, maximized: false });
  });

  it('falls back field by field on malformed input', () => {
    expect(fromPersisted(null)).toEqual(INITIAL_WORKBENCH);
    expect(fromPersisted('nope')).toEqual(INITIAL_WORKBENCH);
    expect(fromPersisted({ view: 'terminal', last: 42, terminalOpen: 'yes' })).toEqual(INITIAL_WORKBENCH);
    expect(fromPersisted({ view: 'run', last: 'bogus' })).toMatchObject({ view: 'run', last: 'preview' });
  });
});

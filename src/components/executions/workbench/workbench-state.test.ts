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

describe('the file opened from the chat', () => {
  it('opens over the view it was opened on, and closing it goes back there', () => {
    const s = run([{ type: 'show', view: 'changes' }, { type: 'jump', view: 'file' }]);
    expect(s).toMatchObject({ view: 'file', from: 'changes', last: 'file', tool: 'changes', covered: 'changes' });
    expect(workbenchReducer(s, { type: 'fileClosed' })).toMatchObject({ view: 'changes', from: null, last: 'changes' });
  });

  it('opened on a closed panel, closing it closes the panel and Tools reopens the last tool', () => {
    const s = run([{ type: 'show', view: 'run' }, { type: 'close' }, { type: 'jump', view: 'file' }]);
    expect(s).toMatchObject({ view: 'file', from: null });
    const closed = workbenchReducer(s, { type: 'fileClosed' });
    expect(closed).toMatchObject({ view: null, last: 'run' });
    expect(workbenchReducer(closed, { type: 'togglePanel' }).view).toBe('run');
  });

  it('flipping to a tool and back to the file still returns to that tool when it closes', () => {
    const s = run([{ type: 'show', view: 'changes' }, { type: 'jump', view: 'file' }, { type: 'show', view: 'files' }, { type: 'jump', view: 'file' }]);
    expect(workbenchReducer(s, { type: 'fileClosed' })).toMatchObject({ view: 'files', last: 'files' });
  });

  it('hidden and restored (Tools twice, or Escape then Tools), closing it still goes back to what it covered', () => {
    const open = run([{ type: 'show', view: 'changes' }, { type: 'jump', view: 'file' }]);
    for (const hide of [{ type: 'togglePanel' }, { type: 'escape' }] as const) {
      const restored = run([hide, { type: 'togglePanel' }], open);
      expect(restored).toMatchObject({ view: 'file', from: null, covered: 'changes' });
      expect(workbenchReducer(restored, { type: 'fileClosed' })).toMatchObject({ view: 'changes', last: 'changes', covered: null });
    }
  });

  it('brought back from its card with the panel closed, closing it closes the panel again', () => {
    const s = run([{ type: 'show', view: 'changes' }, { type: 'jump', view: 'file' }, { type: 'escape' }, { type: 'jump', view: 'file' }]);
    expect(s).toMatchObject({ view: 'file', covered: null });
    expect(workbenchReducer(s, { type: 'fileClosed' })).toMatchObject({ view: null, last: 'changes' });
  });

  it('the Tools toggle hides it and brings it back while it stays open', () => {
    const s = run([{ type: 'jump', view: 'file' }, { type: 'togglePanel' }]);
    expect(s.view).toBeNull();
    expect(workbenchReducer(s, { type: 'togglePanel' }).view).toBe('file');
  });

  it('closed while hidden, the panel reopens on the last tool, not an empty file view', () => {
    const s = run([{ type: 'show', view: 'preview' }, { type: 'jump', view: 'file' }, { type: 'close' }, { type: 'fileClosed' }]);
    expect(s).toMatchObject({ view: null, last: 'preview' });
  });

  it('a jump out of the file drops the back pill to it once it closes', () => {
    const s = run([{ type: 'jump', view: 'file' }, { type: 'jump', view: 'files' }]);
    expect(s.from).toBe('file');
    expect(workbenchReducer(s, { type: 'fileClosed' })).toMatchObject({ view: 'files', from: null });
  });

  it('expanded, it stays expanded going back to a tool and ends with the panel', () => {
    const over = run([{ type: 'show', view: 'changes' }, { type: 'jump', view: 'file' }, { type: 'toggleMaximize' }]);
    expect(workbenchReducer(over, { type: 'fileClosed' })).toMatchObject({ view: 'changes', maximized: true });
    const alone = run([{ type: 'jump', view: 'file' }, { type: 'toggleMaximize' }]);
    expect(workbenchReducer(alone, { type: 'fileClosed' })).toMatchObject({ view: null, maximized: false });
  });

  it('closing with no file view open changes nothing', () => {
    const s = run([{ type: 'show', view: 'run' }]);
    expect(workbenchReducer(s, { type: 'fileClosed' })).toBe(s);
  });
});

describe('persistence', () => {
  it('round-trips the durable fields only', () => {
    const s = run([{ type: 'show', view: 'changes' }, { type: 'jump', view: 'files' }, { type: 'toggleMaximize' }, { type: 'toggleTerminal' }]);
    const restored = fromPersisted(JSON.parse(JSON.stringify(toPersisted(s))));
    expect(restored).toMatchObject({ view: 'files', last: 'files', terminalOpen: true, from: null, maximized: false });
  });

  it('keeps the file view with what it covered, so a reload without the file goes back there', () => {
    const s = run([{ type: 'show', view: 'changes' }, { type: 'jump', view: 'file' }]);
    const restored = fromPersisted(JSON.parse(JSON.stringify(toPersisted(s))));
    expect(restored).toMatchObject({ view: 'file', covered: 'changes', last: 'file', tool: 'changes' });
    expect(workbenchReducer(restored, { type: 'fileClosed' })).toMatchObject({ view: 'changes', last: 'changes' });
  });

  it('reads an entry stored before the file view', () => {
    expect(fromPersisted({ view: 'files', last: 'files', terminalOpen: false })).toMatchObject({ view: 'files', tool: 'files', from: null, covered: null });
    // What the file covered survives the panel being closed over it.
    const hidden = run([{ type: 'show', view: 'run' }, { type: 'jump', view: 'file' }, { type: 'togglePanel' }]);
    expect(fromPersisted(JSON.parse(JSON.stringify(toPersisted(hidden))))).toMatchObject({ view: null, last: 'file', covered: 'run' });
  });

  it('falls back field by field on malformed input', () => {
    expect(fromPersisted(null)).toEqual(INITIAL_WORKBENCH);
    expect(fromPersisted('nope')).toEqual(INITIAL_WORKBENCH);
    expect(fromPersisted({ view: 'terminal', last: 42, terminalOpen: 'yes' })).toEqual(INITIAL_WORKBENCH);
    expect(fromPersisted({ view: 'run', last: 'bogus' })).toMatchObject({ view: 'run', last: 'preview' });
  });
});

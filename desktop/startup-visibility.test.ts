import { expect, it, vi } from 'vitest';
import { createStartupVisibility } from './startup-visibility';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const state = { visible: false, minimized: false, destroyed: false, quitting: false,
    local: '' as string, localForeground: false, reveals: 0 };
  const viewer = { isDestroyed: () => state.destroyed, isVisible: () => state.visible, isMinimized: () => state.minimized };
  const local = {
    reveal: vi.fn(() => { if (!state.local) return false; state.localForeground = true; return true; }),
    hide: vi.fn(() => { if (!state.local) return false; state.localForeground = false; return true; }),
    close: vi.fn(() => { state.local = ''; state.localForeground = false; }),
    isPresented: () => state.localForeground,
  };
  const prepare = vi.fn(async () => { state.visible = false; });
  const reveal = vi.fn(() => { state.visible = true; state.minimized = false; state.reveals++; });
  const flow = createStartupVisibility({ viewer: () => viewer, local, quitting: () => state.quitting,
    revealViewer: reveal, prepareViewerForBackground: prepare });
  const open = (name: string) => vi.fn(async () => { state.visible = false; state.local = name; state.localForeground = true; });
  return { state, flow, local, prepare, reveal, open };
}

it('hands setup to recovery, back to setup, then to a ready viewer with only one foreground surface', async () => {
  const f = fixture(); f.flow.show();
  await f.flow.showLocal(f.open('setup'));
  expect(f.state).toMatchObject({ visible: false, local: 'setup', localForeground: true });
  await f.flow.showLocal(f.open('recovery'));
  expect(f.state).toMatchObject({ visible: false, local: 'recovery', localForeground: true });
  await f.flow.showLocal(f.open('setup'));
  f.flow.connected();
  expect(f.state).toMatchObject({ visible: true, local: '', localForeground: false });
  expect(f.prepare).toHaveBeenCalledOnce();
});

it('does not foreground a quiet login, minimized viewer or explicitly hidden controls on readiness', async () => {
  const quiet = fixture(); quiet.flow.connected();
  expect(quiet.reveal).not.toHaveBeenCalled();
  const minimized = fixture(); minimized.flow.show(); minimized.state.minimized = true;
  minimized.reveal.mockClear(); minimized.flow.connected();
  expect(minimized.reveal).not.toHaveBeenCalled();
  const hidden = fixture(); await hidden.flow.showLocal(hidden.open('setup')); await hidden.flow.hide();
  hidden.flow.connected();
  expect(hidden.state).toMatchObject({ visible: false, local: '' });
});

it('remembers foreground intent during a hidden local-page load and transfers it on readiness', async () => {
  const f = fixture(); f.flow.show();
  const loaded = deferred();
  const opening = f.flow.showLocal(async () => { f.state.local = 'setup'; await loaded.promise; });
  await vi.waitFor(() => expect(f.state.local).toBe('setup'));
  expect(f.state.visible).toBe(false); expect(f.state.localForeground).toBe(false);
  f.flow.connected();
  expect(f.state.visible).toBe(true); expect(f.state.local).toBe('');
  // The real local host invalidates this page's asynchronous load on close.
  loaded.resolve(); await opening;
  expect(f.state.visible).toBe(true);
});

it('cancels a pending setup request when readiness or user activation restores the viewer', async () => {
  for (const operation of ['connected', 'showViewer', 'show'] as const) {
    const f = fixture(); f.flow.show();
    const guard = deferred();
    f.prepare.mockImplementation(async () => { await guard.promise; });
    const open = f.open('setup');
    const opening = f.flow.showLocal(open);
    await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce());
    f.flow[operation]();
    guard.resolve(); await opening;
    expect(open).not.toHaveBeenCalled();
    expect(f.state.visible).toBe(true);
  }
});

it('keeps voice input visible when the renderer refuses to background', async () => {
  const f = fixture(); f.flow.show();
  f.prepare.mockResolvedValue(undefined); // Native guard leaves viewer visible.
  const open = f.open('setup');
  await f.flow.showLocal(open);
  expect(open).not.toHaveBeenCalled();
  expect(f.state.visible).toBe(true);
});

it('accepts a minimized viewer as safely backgrounded on Linux or without a tray', async () => {
  const f = fixture(); f.flow.show();
  f.prepare.mockImplementation(async () => { f.state.minimized = true; });
  const open = f.open('setup');
  await f.flow.showLocal(open);
  expect(open).toHaveBeenCalledOnce();
  expect(f.state.local).toBe('setup');
});

it('shares one in-flight voice guard and opens only the latest requested panel', async () => {
  const f = fixture(); f.flow.show();
  const guard = deferred();
  f.prepare.mockImplementation(async () => { await guard.promise; f.state.visible = false; });
  const setup = f.open('setup'); const recovery = f.open('recovery');
  const first = f.flow.showLocal(setup); const second = f.flow.showLocal(recovery);
  await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce());
  guard.resolve(); await Promise.all([first, second]);
  expect(setup).not.toHaveBeenCalled(); expect(recovery).toHaveBeenCalledOnce();
});

it('cancels pending panel presentation when the user hides or quits', async () => {
  const f = fixture(); f.flow.show();
  const guard = deferred();
  f.prepare.mockImplementation(async () => { await guard.promise; f.state.visible = false; });
  const setup = f.open('setup');
  const opening = f.flow.showLocal(setup);
  const hiding = f.flow.hide();
  guard.resolve(); await Promise.all([opening, hiding]);
  f.flow.connected();
  expect(setup).not.toHaveBeenCalled(); expect(f.state.visible).toBe(false);
  f.state.quitting = true;
  await f.flow.showLocal(setup); f.flow.show(); f.flow.showViewer(); f.flow.connected();
  expect(setup).not.toHaveBeenCalled(); expect(f.state.visible).toBe(false);
});

it('retains the user hide intent if readiness arrives while the voice guard is pending', async () => {
  const f = fixture(); f.flow.show();
  const guard = deferred();
  f.prepare.mockImplementation(async () => { await guard.promise; f.state.visible = false; });
  const hiding = f.flow.hide();
  f.reveal.mockClear(); f.flow.connected();
  expect(f.reveal).not.toHaveBeenCalled();
  guard.resolve(); await hiding;
  expect(f.state.visible).toBe(false);
});

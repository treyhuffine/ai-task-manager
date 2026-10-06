import { expect, it, vi } from 'vitest';
import { createStartupVisibility } from './startup-visibility';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function fixture() {
  const state = { visible: false, minimized: false, destroyed: false, quitting: false, local: '', loaded: false };
  const viewer = { isDestroyed: () => state.destroyed, isVisible: () => state.visible, isMinimized: () => state.minimized };
  const local = {
    hasActive: () => !!state.local,
    reveal: vi.fn(() => !!state.local),
    focus: vi.fn(() => !!state.local && state.loaded && state.visible && !state.minimized),
    close: vi.fn(() => { state.local = ''; state.loaded = false; }),
  };
  const prepare = vi.fn(async () => true);
  const reveal = vi.fn(() => { state.visible = true; state.minimized = false; });
  const focusViewer = vi.fn();
  const background = vi.fn(() => { state.visible = false; });
  const flow = createStartupVisibility({ viewer: () => viewer, local, quitting: () => state.quitting,
    revealWindow: reveal, focusViewer, backgroundWindow: background, canCoverViewer: prepare });
  const open = (name: string, load?: Promise<void>) => vi.fn(async () => {
    state.local = name; state.loaded = false;
    if (load) await load;
    // The real local host invalidates in-flight loads when closed/superseded.
    if (state.local === name) state.loaded = true;
  });
  return { state, flow, local, prepare, reveal, focusViewer, background, open };
}

it('keeps the same native window visible through setup, recovery and authenticated app readiness', async () => {
  const f = fixture(); f.flow.show();
  await f.flow.showLocal(f.open('setup'));
  expect(f.state).toMatchObject({ visible: true, local: 'setup' });
  await f.flow.showLocal(f.open('recovery'));
  expect(f.state).toMatchObject({ visible: true, local: 'recovery' });
  await f.flow.showLocal(f.open('setup'));
  f.reveal.mockClear(); f.focusViewer.mockClear();
  f.flow.connected();
  expect(f.state).toMatchObject({ visible: true, local: '' });
  expect(f.reveal).not.toHaveBeenCalled();
  expect(f.focusViewer).toHaveBeenCalledOnce();
  expect(f.background).not.toHaveBeenCalled();
  expect(f.prepare).toHaveBeenCalledOnce();
});

it('does not foreground quiet login, minimized app or explicitly hidden settings when connected', async () => {
  const quiet = fixture(); quiet.state.local = 'loading'; quiet.flow.connected();
  expect(quiet.reveal).not.toHaveBeenCalled();
  expect(quiet.focusViewer).not.toHaveBeenCalled();
  const minimized = fixture(); minimized.flow.show(); minimized.state.minimized = true;
  minimized.reveal.mockClear(); minimized.focusViewer.mockClear(); minimized.flow.connected();
  expect(minimized.reveal).not.toHaveBeenCalled();
  expect(minimized.focusViewer).not.toHaveBeenCalled();
  expect(minimized.state.minimized).toBe(true);
  const hidden = fixture(); await hidden.flow.showLocal(hidden.open('setup')); await hidden.flow.hide();
  hidden.reveal.mockClear(); hidden.focusViewer.mockClear(); hidden.flow.connected();
  expect(hidden.state).toMatchObject({ visible: false, local: '' });
  expect(hidden.reveal).not.toHaveBeenCalled();
  expect(hidden.focusViewer).not.toHaveBeenCalled();
});

it('closes a pending local page when readiness arrives without changing native visibility', async () => {
  const f = fixture(); const loaded = deferred();
  const opening = f.flow.showLocal(f.open('setup', loaded.promise));
  await vi.waitFor(() => expect(f.state.local).toBe('setup'));
  expect(f.state.visible).toBe(true);
  f.reveal.mockClear();
  f.flow.connected();
  f.local.focus.mockClear(); loaded.resolve(); await opening;
  expect(f.state).toMatchObject({ visible: true, local: '' });
  expect(f.reveal).not.toHaveBeenCalled();
  expect(f.local.focus).not.toHaveBeenCalled();
});

it('cancels a pending panel request when readiness or user activation restores the app', async () => {
  for (const operation of ['connected', 'showViewer', 'show'] as const) {
    const f = fixture(); f.flow.show();
    const guard = deferred<boolean>(); f.prepare.mockReturnValue(guard.promise);
    const open = f.open('setup'); const opening = f.flow.showLocal(open);
    await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce());
    f.flow[operation](); guard.resolve(true); await opening;
    expect(open).not.toHaveBeenCalled();
    expect(f.state.visible).toBe(true);
  }
});

it('keeps active voice input visible when the renderer vetoes covering or hiding it', async () => {
  const f = fixture(); f.flow.show(); f.prepare.mockResolvedValue(false);
  const open = f.open('setup'); await f.flow.showLocal(open); await f.flow.hide();
  expect(open).not.toHaveBeenCalled();
  expect(f.background).not.toHaveBeenCalled();
  expect(f.state.visible).toBe(true);
});

it('restores a minimized or hidden app only for an explicit panel request', async () => {
  const f = fixture(); f.state.visible = true; f.state.minimized = true;
  await f.flow.showLocal(f.open('setup'));
  expect(f.state).toMatchObject({ visible: true, minimized: false, local: 'setup' });
  expect(f.reveal).toHaveBeenCalledOnce();
  expect(f.local.focus).toHaveBeenCalledOnce();
});

it('shares an in-flight voice guard and opens only the latest requested panel', async () => {
  const f = fixture(); f.flow.show();
  const guard = deferred<boolean>(); f.prepare.mockReturnValue(guard.promise);
  const setup = f.open('setup'); const recovery = f.open('recovery');
  const first = f.flow.showLocal(setup); const second = f.flow.showLocal(recovery);
  await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce());
  guard.resolve(true); await Promise.all([first, second]);
  expect(setup).not.toHaveBeenCalled(); expect(recovery).toHaveBeenCalledOnce();
  expect(f.state).toMatchObject({ visible: true, local: 'recovery' });
});

it('cancels a pending panel presentation when the user requests hide', async () => {
  const f = fixture(); f.flow.show();
  const guard = deferred<boolean>(); f.prepare.mockReturnValue(guard.promise);
  const setup = f.open('setup');
  const opening = f.flow.showLocal(setup); const hiding = f.flow.hide();
  guard.resolve(true); await Promise.all([opening, hiding]);
  f.flow.connected();
  expect(setup).not.toHaveBeenCalled(); expect(f.state.visible).toBe(false);
  expect(f.background).toHaveBeenCalledOnce();
});

it('retains an explicit hide intent when readiness arrives while the voice guard is pending', async () => {
  const f = fixture(); f.flow.show();
  const guard = deferred<boolean>(); f.prepare.mockReturnValue(guard.promise);
  const hiding = f.flow.hide();
  await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce());
  f.reveal.mockClear(); f.flow.connected();
  guard.resolve(true); await hiding;
  expect(f.state.visible).toBe(false);
  expect(f.reveal).not.toHaveBeenCalled();
  expect(f.background).toHaveBeenCalledOnce();
});

it('lets a later user show intent supersede a pending hide', async () => {
  for (const action of ['show', 'showViewer', 'showLocal'] as const) {
    const f = fixture(); f.flow.show();
    const guard = deferred<boolean>(); f.prepare.mockReturnValue(guard.promise);
    const hiding = f.flow.hide();
    await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce());
    const showing = action === 'showLocal' ? f.flow.showLocal(f.open('settings')) : f.flow[action]();
    guard.resolve(true); await Promise.all([hiding, showing]);
    expect(f.background).not.toHaveBeenCalled();
    expect(f.state.visible).toBe(true);
  }
});

it('does not raise the native window after a hide or minimize during a local page load', async () => {
  for (const action of ['hide', 'minimize'] as const) {
    const f = fixture(); const loaded = deferred();
    const opening = f.flow.showLocal(f.open('setup', loaded.promise));
    await vi.waitFor(() => expect(f.state.local).toBe('setup'));
    if (action === 'hide') await f.flow.hide(); else f.state.minimized = true;
    f.reveal.mockClear(); f.local.focus.mockClear(); f.focusViewer.mockClear();
    loaded.resolve(); await opening;
    expect(f.reveal).not.toHaveBeenCalled();
    expect(f.local.focus).not.toHaveBeenCalled();
    expect(f.focusViewer).not.toHaveBeenCalled();
    expect(action === 'hide' ? !f.state.visible : f.state.minimized).toBe(true);
  }
});

it('respects native hide or minimize while the voice guard is pending', async () => {
  for (const action of ['hide', 'minimize'] as const) {
    const f = fixture(); f.flow.show();
    const guard = deferred<boolean>(); f.prepare.mockReturnValue(guard.promise);
    const open = f.open('setup'); const opening = f.flow.showLocal(open);
    await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce());
    if (action === 'hide') f.state.visible = false; else f.state.minimized = true;
    f.reveal.mockClear(); guard.resolve(true); await opening;
    expect(open).not.toHaveBeenCalled(); expect(f.reveal).not.toHaveBeenCalled();
  }
});

it('keeps a Linux or tray-free minimize in place when readiness follows close', async () => {
  const f = fixture(); await f.flow.showLocal(f.open('setup'));
  f.background.mockImplementation(() => { f.state.minimized = true; });
  await f.flow.hide(); f.reveal.mockClear(); f.flow.connected();
  expect(f.state).toMatchObject({ visible: true, minimized: true, local: '' });
  expect(f.reveal).not.toHaveBeenCalled();
});

it('does not focus a superseded local load when its asynchronous completion arrives late', async () => {
  const f = fixture(); const firstLoad = deferred(); const secondLoad = deferred();
  const first = f.flow.showLocal(f.open('setup', firstLoad.promise));
  await vi.waitFor(() => expect(f.state.local).toBe('setup'));
  const second = f.flow.showLocal(f.open('recovery', secondLoad.promise));
  f.local.focus.mockClear(); firstLoad.resolve(); await first;
  expect(f.local.focus).not.toHaveBeenCalled();
  secondLoad.resolve(); await second;
  expect(f.local.focus).toHaveBeenCalledOnce();
  expect(f.state.local).toBe('recovery');
});

it('allows retry after a guard error and never opens a panel from that failed request', async () => {
  const f = fixture(); const open = f.open('setup');
  f.prepare.mockRejectedValueOnce(new Error('renderer unavailable'));
  await expect(f.flow.showLocal(open)).rejects.toThrow('renderer unavailable');
  expect(open).not.toHaveBeenCalled();
  await f.flow.showLocal(open);
  expect(open).toHaveBeenCalledOnce();
  expect(f.prepare).toHaveBeenCalledTimes(2);
});

it('does not present, focus or background anything once quitting starts', async () => {
  const f = fixture(); f.flow.show();
  const guard = deferred<boolean>(); f.prepare.mockReturnValue(guard.promise);
  const open = f.open('setup'); const opening = f.flow.showLocal(open); const hiding = f.flow.hide();
  f.state.quitting = true; f.reveal.mockClear(); f.focusViewer.mockClear();
  guard.resolve(true); await Promise.all([opening, hiding]);
  await f.flow.showLocal(open); await f.flow.hide(); f.flow.show(); f.flow.showViewer(); f.flow.connected();
  expect(open).not.toHaveBeenCalled(); expect(f.reveal).not.toHaveBeenCalled();
  expect(f.background).not.toHaveBeenCalled(); expect(f.focusViewer).not.toHaveBeenCalled();
});

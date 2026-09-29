import { expect, it, vi } from 'vitest';
import { backgroundWindow, revealWindow } from './window-visibility';

function window() {
  return { isDestroyed: vi.fn(() => false), isMinimized: vi.fn(() => false),
    restore: vi.fn(), show: vi.fn(), focus: vi.fn(), hide: vi.fn(), minimize: vi.fn() };
}

it('hides the Mac window without closing its renderer', () => {
  const current = window();
  backgroundWindow(current, 'darwin', true);
  expect(current.hide).toHaveBeenCalledOnce();
  expect(current.minimize).not.toHaveBeenCalled();
});

it.each([['linux', true], ['linux', false], ['darwin', false]] as const)('keeps a taskbar or Dock recovery path on %s with tray=%s', (platform, tray) => {
  const current = window();
  backgroundWindow(current, platform, tray);
  expect(current.minimize).toHaveBeenCalledOnce();
  expect(current.hide).not.toHaveBeenCalled();
});

it('restores a minimized window before showing and focusing it', () => {
  const current = window(); current.isMinimized.mockReturnValue(true);
  revealWindow(current);
  expect(current.restore).toHaveBeenCalledOnce();
  expect(current.show).toHaveBeenCalledOnce();
  expect(current.focus).toHaveBeenCalledOnce();
  expect(current.restore.mock.invocationCallOrder[0]).toBeLessThan(current.show.mock.invocationCallOrder[0]);
  expect(current.show.mock.invocationCallOrder[0]).toBeLessThan(current.focus.mock.invocationCallOrder[0]);
});

it('reopens a hidden window without changing its renderer', () => {
  const current = window(); revealWindow(current);
  expect(current.show).toHaveBeenCalledOnce(); expect(current.focus).toHaveBeenCalledOnce();
  expect(current.restore).not.toHaveBeenCalled();
});

it('ignores absent and destroyed windows during shutdown', () => {
  revealWindow(undefined); backgroundWindow(undefined, 'darwin', true);
  const current = window(); current.isDestroyed.mockReturnValue(true);
  revealWindow(current); backgroundWindow(current, 'darwin', true);
  expect(current.show).not.toHaveBeenCalled(); expect(current.hide).not.toHaveBeenCalled();
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useRef: <T,>(value: T) => ({ current: value }),
}));

import { useLongPress } from './use-long-press';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('a tap does the usual thing, holding does the other, and never both', () => {
  const tap = vi.fn();
  const hold = vi.fn();
  const press = useLongPress(tap, hold);

  press.onPointerDown();
  vi.advanceTimersByTime(200);
  press.onPointerUp();
  press.onClick();
  expect([tap.mock.calls.length, hold.mock.calls.length]).toEqual([1, 0]);

  press.onPointerDown();
  vi.advanceTimersByTime(500);
  press.onPointerUp();
  press.onClick();
  expect([tap.mock.calls.length, hold.mock.calls.length]).toEqual([1, 1]);

  // A right click (or the phone's own long-press menu) is a hold, once.
  press.onPointerDown();
  press.onContextMenu({ preventDefault: () => {} });
  vi.advanceTimersByTime(500);
  press.onClick();
  expect([tap.mock.calls.length, hold.mock.calls.length]).toEqual([1, 2]);

  // Sliding off cancels the hold.
  press.onPointerDown();
  press.onPointerLeave();
  vi.advanceTimersByTime(500);
  expect(hold).toHaveBeenCalledTimes(2);
});

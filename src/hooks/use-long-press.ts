'use client';

import { useRef } from 'react';

/**
 * A tap does one thing and holding does another, on a phone (and a right
 * click does the held thing on a desktop). The tap after a hold is
 * swallowed, so holding never also taps.
 */
export function useLongPress(onTap: () => void, onHold: () => void, holdMs = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: () => {
      held.current = false;
      cancel();
      timer.current = setTimeout(() => {
        held.current = true;
        timer.current = null;
        onHold();
      }, holdMs);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: { preventDefault: () => void }) => {
      e.preventDefault();
      cancel();
      if (!held.current) {
        held.current = true;
        onHold();
      }
    },
    onClick: () => {
      if (held.current) {
        held.current = false;
        return;
      }
      onTap();
    },
  };
}

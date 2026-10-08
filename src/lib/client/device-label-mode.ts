'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * When an execution names its device. A reversible UI trial: the standard
 * case goes unsaid, and only the exception is shown.
 *
 *   - `away`   (default) — only when the work runs away from the home
 *     ("MacBook"). Work on the home is unlabeled, which is what a plain +
 *     does unless the agent's default says otherwise. Its device is still
 *     in the execution's details, and moving it is in its … menu.
 *   - `always` — every execution names its device once there's more than
 *     one, the home included ("Mac Mini"), as before.
 *
 * Per-browser in localStorage, like `entity-view-mode.ts`. When the trial
 * settles, fold the winner in and retire the switch.
 */

export type DeviceLabelMode = 'away' | 'always';

export const DEVICE_LABEL_MODE_KEY = 'ri.client.deviceLabelMode';
export const DEFAULT_DEVICE_LABEL_MODE: DeviceLabelMode = 'away';

const CHANGE_EVENT = 'ri:device-label-mode-changed';

export function parseDeviceLabelMode(raw: unknown): DeviceLabelMode {
  return raw === 'always' || raw === 'away' ? raw : DEFAULT_DEVICE_LABEL_MODE;
}

function read(): DeviceLabelMode {
  if (typeof window === 'undefined') return DEFAULT_DEVICE_LABEL_MODE;
  try {
    return parseDeviceLabelMode(window.localStorage.getItem(DEVICE_LABEL_MODE_KEY));
  } catch {
    return DEFAULT_DEVICE_LABEL_MODE;
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === DEVICE_LABEL_MODE_KEY || e.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function getServerSnapshot(): DeviceLabelMode {
  return DEFAULT_DEVICE_LABEL_MODE;
}

export function setDeviceLabelMode(next: DeviceLabelMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DEVICE_LABEL_MODE_KEY, next);
  } catch {
    /* localStorage can throw in private mode — non-fatal */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useDeviceLabelMode(): { mode: DeviceLabelMode; setMode: (next: DeviceLabelMode) => void } {
  const mode = useSyncExternalStore(subscribe, read, getServerSnapshot);
  const setMode = useCallback((next: DeviceLabelMode) => setDeviceLabelMode(next), []);
  return { mode, setMode };
}

'use client';

import { useSyncExternalStore } from 'react';

let open = false;
const listeners = new Set<() => void>();
export function setQuickCaptureOpen(value: boolean) {
  if (open === value) return;
  open = value; listeners.forEach(listener => listener());
}
export function toggleQuickCapture() { setQuickCaptureOpen(!open); }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useQuickCaptureOpen() { return useSyncExternalStore(subscribe, () => open, () => false); }

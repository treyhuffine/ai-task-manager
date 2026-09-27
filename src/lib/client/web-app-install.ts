'use client';

import { useSyncExternalStore } from 'react';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type InstallState = {
  ready: boolean;
  installed: boolean;
  canPrompt: boolean;
  secure: boolean;
  desktop: boolean;
};

const initial: InstallState = { ready: false, installed: false, canPrompt: false, secure: false, desktop: false };
let state = initial;
let pendingPrompt: InstallPromptEvent | undefined;
let started = false;
const listeners = new Set<() => void>();

function publish(next: InstallState) {
  state = next;
  for (const listener of listeners) listener();
}

export function startWebAppInstall() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const display = window.matchMedia('(display-mode: standalone)');
  const refresh = () => publish({
    ready: true,
    installed: display.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
    canPrompt: !!pendingPrompt,
    secure: window.isSecureContext,
    desktop: !!window.riDesktop,
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the browser event until the user chooses Install in settings. The
    // settings modal may not have mounted when the browser announces it.
    event.preventDefault();
    pendingPrompt = event as InstallPromptEvent;
    refresh();
  });
  window.addEventListener('appinstalled', () => {
    pendingPrompt = undefined;
    refresh();
    publish({ ...state, installed: true });
  });
  display.addEventListener('change', refresh);
  refresh();

  // Use the existing push worker. Registration neither asks for notification
  // permission nor subscribes this device. Electron keeps its own lifecycle.
  if (process.env.NODE_ENV === 'production' && window.isSecureContext && !window.riDesktop && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/notifications-sw.js', { updateViaCache: 'none' }).catch(() => {
      // Some private browser modes disallow workers. Ri still works online and
      // the push settings show their own actionable registration error.
    });
  }
}

export async function promptWebAppInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = pendingPrompt;
  if (!event || state.installed || state.desktop) return 'unavailable';
  pendingPrompt = undefined;
  publish({ ...state, canPrompt: false });
  await event.prompt();
  return (await event.userChoice).outcome;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useWebAppInstall() {
  return useSyncExternalStore(subscribe, () => state, () => initial);
}

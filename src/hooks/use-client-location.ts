'use client';

import { useMemo, useSyncExternalStore } from 'react';

/**
 * Whether the browser is running on the same machine that hosts the app.
 *
 * Default rule: `localhost` / `127.0.0.1` / `::1` → host. Anything else →
 * remote (e.g. user is tunneling in via ngrok, Tailscale, or LAN IP).
 *
 * Override: the user can claim any origin as "my main machine" via the
 * settings page. The claimed hostnames live in localStorage under
 * `HOST_ORIGINS_KEY`. Both the override and the default re-evaluate when
 * the storage changes so multiple tabs stay in sync.
 *
 * Why this matters: same-machine clients can fire `file://` and editor
 * deep links because the worktree paths the UI shows ARE valid on the
 * client. A remote client opens things on its own device through the
 * worker there (P3.5), or moves the work with Continue here (P4.2).
 */

export type ClientLocationKind = 'host' | 'remote';

export type ClientLocationReason = 'localhost' | 'override' | 'default-remote';

export interface ClientLocation {
  kind: ClientLocationKind;
  reason: ClientLocationReason;
  hostname: string;
}

export const HOST_ORIGINS_KEY = 'ri.client.host-origins';
const HOST_ORIGINS_EVENT = 'ri:host-origins-changed';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function readOverrideText(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(HOST_ORIGINS_KEY) ?? '';
  } catch {
    return '';
  }
}

function parseOverrideList(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function computeLocation(hostname: string, overrides: string[]): ClientLocation {
  if (LOOPBACK_HOSTS.has(hostname)) {
    return { kind: 'host', reason: 'localhost', hostname };
  }
  if (overrides.includes(hostname)) {
    return { kind: 'host', reason: 'override', hostname };
  }
  return { kind: 'remote', reason: 'default-remote', hostname };
}

function readOverrideList(): string[] {
  return parseOverrideList(readOverrideText());
}

function subscribe(onChange: () => void): () => void {
  function onStorage(event: StorageEvent) {
    if (event.key === HOST_ORIGINS_KEY || event.key === null) onChange();
  }
  window.addEventListener('storage', onStorage);
  window.addEventListener(HOST_ORIGINS_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(HOST_ORIGINS_EVENT, onChange);
  };
}

/**
 * What the location is read from, as one string: the hostname, a newline, and
 * the stored claims. A string stays equal while neither changes, so React
 * re-renders only when the answer can change.
 */
function readInputs(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.hostname}\n${readOverrideText()}`;
}

/** The server render has no browser to ask, so it reads as remote. */
function serverInputs(): string {
  return '';
}

function locationFrom(inputs: string): ClientLocation {
  if (!inputs) return { kind: 'remote', reason: 'default-remote', hostname: '' };
  const newline = inputs.indexOf('\n');
  return computeLocation(inputs.slice(0, newline), parseOverrideList(inputs.slice(newline + 1)));
}

export function useClientLocation(): ClientLocation {
  const inputs = useSyncExternalStore(subscribe, readInputs, serverInputs);
  return useMemo(() => locationFrom(inputs), [inputs]);
}

export function isHostnameClaimed(hostname: string): boolean {
  return readOverrideList().includes(hostname);
}

export function setHostnameClaim(hostname: string, claimed: boolean): void {
  if (typeof window === 'undefined') return;
  const current = readOverrideList();
  const next = claimed
    ? Array.from(new Set([...current, hostname]))
    : current.filter((h) => h !== hostname);
  try {
    window.localStorage.setItem(HOST_ORIGINS_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(HOST_ORIGINS_EVENT));
  } catch {
    // ignore
  }
}

'use client';

import { useEffect, useState } from 'react';

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
 * client. Remote clients can't reach the laptop's filesystem and need
 * the takeover flow instead.
 */

export type ClientLocationKind = 'host' | 'remote';

export type ClientLocationReason = 'localhost' | 'override' | 'default-remote';

export interface ClientLocation {
  kind: ClientLocationKind;
  reason: ClientLocationReason;
  hostname: string;
}

export const HOST_ORIGINS_KEY = 'flow.client.host-origins';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function readOverrideList(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HOST_ORIGINS_KEY);
    if (!raw) return [];
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

function readLocation(): ClientLocation {
  if (typeof window === 'undefined') {
    return { kind: 'remote', reason: 'default-remote', hostname: '' };
  }
  return computeLocation(window.location.hostname, readOverrideList());
}

export function useClientLocation(): ClientLocation {
  const [location, setLocation] = useState<ClientLocation>(() => readLocation());

  useEffect(() => {
    setLocation(readLocation());

    function onStorage(event: StorageEvent) {
      if (event.key === HOST_ORIGINS_KEY || event.key === null) {
        setLocation(readLocation());
      }
    }
    window.addEventListener('storage', onStorage);

    function onLocal() {
      setLocation(readLocation());
    }
    window.addEventListener('flow:host-origins-changed', onLocal);

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('flow:host-origins-changed', onLocal);
    };
  }, []);

  return location;
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
    window.dispatchEvent(new Event('flow:host-origins-changed'));
  } catch {
    // ignore
  }
}

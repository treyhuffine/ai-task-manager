'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { PAIRING_TOKEN_FRAGMENT_KEY } from '@/constants/app';
import {
  AUTH_TOKEN_STORAGE_KEY,
  getAuthToken,
  setAuthToken,
} from '@/lib/api/client';

/**
 * Consumes `#${PAIRING_TOKEN_FRAGMENT_KEY}=<token>` from the URL fragment,
 * persists it to localStorage, and strips the fragment. Redirects to /pair
 * when no token is present.
 */
export function PairingBootstrap() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;

    if (hash) {
      const params = new URLSearchParams(hash);
      const fromUrl = params.get(PAIRING_TOKEN_FRAGMENT_KEY);
      if (fromUrl) {
        setAuthToken(fromUrl);
        // Mirror into an httpOnly cookie so browser-native loads authenticate
        // without a header. Fire-and-forget: Bearer-header calls still work
        // if this fails.
        fetch('/api/session', {
          method: 'POST',
          headers: { authorization: `Bearer ${fromUrl}` },
        }).catch(() => {});
        const clean = window.location.pathname + window.location.search;
        window.history.replaceState(null, '', clean);
        return;
      }
    }

    const existing = getAuthToken();
    if (!existing && pathname !== '/pair') {
      router.replace('/pair');
      return;
    }

    // Best-effort cookie sync for already-paired sessions. JS can't see the
    // httpOnly cookie so we can't check whether we already set one; calling
    // the endpoint is idempotent (sets the same value) and cheap. This also
    // keeps the cookie's Max-Age sliding forward each time the app loads.
    if (existing) {
      fetch('/api/session', {
        method: 'POST',
        headers: { authorization: `Bearer ${existing}` },
      }).catch(() => {});
    }
  }, [pathname, router]);

  // Keep multi-tab state in sync: if another tab clears the token, redirect.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === AUTH_TOKEN_STORAGE_KEY && !e.newValue && pathname !== '/pair') {
        router.replace('/pair');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [pathname, router]);

  return null;
}

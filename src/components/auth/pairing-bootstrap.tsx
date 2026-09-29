'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ASSOCIATE_FRAGMENT_KEY, PAIRING_TOKEN_FRAGMENT_KEY, THIS_COMPUTER_STORAGE_KEY } from '@/constants/app';
import {
  AUTH_TOKEN_STORAGE_KEY,
  getAuthToken,
  setAuthToken,
} from '@/lib/api/client';

/**
 * Redeem `#associate=<code>`: a worker on this computer opened this page to
 * say which computer the browser is on (docs/homes-build.md, P2.2, "This
 * Mac"). The browser's own key redeems it. Identity only.
 */
async function associateThisBrowser(code: string, token: string): Promise<void> {
  try {
    const res = await fetch('/api/devices/associate', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const body = (await res.json().catch(() => null)) as { computer?: { id: string; name: string }; message?: string } | null;
    if (!res.ok || !body?.computer) {
      toast.error(body?.message ?? 'This browser could not be linked to its computer.');
      return;
    }
    window.localStorage.setItem(THIS_COMPUTER_STORAGE_KEY, JSON.stringify(body.computer));
    toast.success(`This browser is on ${body.computer.name}`);
  } catch {
    toast.error('This browser could not be linked to its computer.');
  }
}

/**
 * Consumes `#${PAIRING_TOKEN_FRAGMENT_KEY}=<token>` from the URL fragment,
 * persists it to localStorage, and strips the fragment. Redirects to /pair
 * when no token is present. Also redeems `#associate=<code>` once paired.
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
      const associate = params.get(ASSOCIATE_FRAGMENT_KEY);
      const paired = getAuthToken();
      if (associate && paired) {
        void associateThisBrowser(associate, paired);
        const clean = window.location.pathname + window.location.search;
        window.history.replaceState(null, '', clean);
        return;
      }
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

  // A worker's association link can arrive in a page that's already open,
  // where only the fragment changes and nothing reloads.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onHashChange = () => {
      const hash = window.location.hash.replace(/^#/, '');
      const code = new URLSearchParams(hash).get(ASSOCIATE_FRAGMENT_KEY);
      const paired = getAuthToken();
      if (!code || !paired) return;
      void associateThisBrowser(code, paired);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

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

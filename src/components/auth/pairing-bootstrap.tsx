'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  AUTH_TOKEN_STORAGE_KEY,
  getAuthToken,
  setAuthToken,
} from '@/lib/api/client';

/**
 * Consumes `#t=<token>` from the URL fragment, persists it to localStorage,
 * and strips the fragment. Redirects to /pair when no token is present.
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
      const fromUrl = params.get('t');
      if (fromUrl) {
        setAuthToken(fromUrl);
        const clean = window.location.pathname + window.location.search;
        window.history.replaceState(null, '', clean);
        return;
      }
    }

    if (!getAuthToken() && pathname !== '/pair') {
      router.replace('/pair');
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

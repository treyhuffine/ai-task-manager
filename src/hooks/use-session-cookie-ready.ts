'use client';

import { useEffect, useState } from 'react';
import { syncSessionCookie } from '@/lib/api/client';

/** Frames and links the browser loads itself (an HTML or PDF preview, a
 * download) authenticate with the session cookie, so wait for the page's
 * cookie sync: already settled, except right after pairing. */
export function useSessionCookieReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void syncSessionCookie().then(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, []);
  return ready;
}

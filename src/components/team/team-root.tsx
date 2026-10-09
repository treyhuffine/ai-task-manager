'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

/** The pages a team space has. Everything else is a personal page. */
const TEAM_PATHS = new Set(['/', '/join']);

/**
 * The root of a team space's pages (docs/homes-spec.md §3.2). A team serves
 * its shared work and its links, nothing personal: a personal page's address
 * goes back to the team rather than mounting a screen built for a home.
 */
export function TeamRoot({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const allowed = TEAM_PATHS.has(pathname);
  useEffect(() => {
    if (!allowed) router.replace('/');
  }, [allowed, router]);
  return allowed ? children : null;
}

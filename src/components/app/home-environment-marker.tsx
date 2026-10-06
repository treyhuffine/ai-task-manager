'use client';

/**
 * Marks every screen of a development server: an amber strip along the top,
 * a small "Dev" tab, and the tab title prefixed, so a dev window and a real
 * one are never mistaken for each other (docs/environments.md). A production
 * server shows nothing, wherever its home lives, so no end user ever sees it.
 *
 * The environment comes from the server per request (`system.hostInfoGet`),
 * never from the build.
 */

import { useEffect } from 'react';
import { useHostInfo } from '@/hooks/use-host-info';
import { Tip } from '@/components/ui/tip';

export function HomeEnvironmentMarker() {
  const { data } = useHostInfo();
  const marked = data?.environment === 'development';
  const label = 'Dev';

  useEffect(() => {
    if (!marked) return;
    const prefix = `${label} · `;
    const apply = () => {
      if (!document.title.startsWith(prefix)) document.title = `${prefix}${document.title}`;
    };
    apply();
    // Pages retitle themselves as they navigate. Keep the prefix on.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      if (document.title.startsWith(prefix)) document.title = document.title.slice(prefix.length);
    };
  }, [marked, label]);

  if (!marked) return null;
  const description = `Development home: ${data?.appRoot}. Its data is separate from your real one.`;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center" aria-label={description} role="note">
      <div className="absolute inset-x-0 top-0 h-[3px] bg-amber-500" />
      <Tip label={description}>
        <div
          className="pointer-events-auto mt-[3px] rounded-b-md bg-amber-500 px-2 pb-0.5 text-[10px] font-semibold uppercase leading-4 tracking-wider text-amber-950 shadow-sm"
        >
          {label}
        </div>
      </Tip>
    </div>
  );
}

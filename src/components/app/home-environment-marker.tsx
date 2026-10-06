'use client';

/**
 * Marks every screen of a home that isn't production: an amber strip along
 * the top, a small tab naming the home, and the tab title prefixed, so a dev
 * window and a production window are never mistaken for each other
 * (docs/environments.md). Production shows nothing.
 *
 * The environment comes from the server per request (`system.hostInfoGet`),
 * never from the build, so a release build can't carry where it was built.
 */

import { useEffect } from 'react';
import { useHostInfo } from '@/hooks/use-host-info';

export function HomeEnvironmentMarker() {
  const { data } = useHostInfo();
  const environment = data?.environment;
  const label = environment === 'development' ? 'Dev' : data?.homeLabel;
  const marked = environment !== undefined && environment !== 'production' && Boolean(label);

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
  const description =
    environment === 'development'
      ? `Development home: ${data?.appRoot}. Its data is separate from production.`
      : `Isolated home: ${data?.appRoot}. Its data is separate from production.`;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center" aria-label={description} role="note">
      <div className="absolute inset-x-0 top-0 h-[3px] bg-amber-500" />
      <div
        className="pointer-events-auto mt-[3px] rounded-b-md bg-amber-500 px-2 pb-0.5 text-[10px] font-semibold uppercase leading-4 tracking-wider text-amber-950 shadow-sm"
        title={description}
      >
        {label}
      </div>
    </div>
  );
}

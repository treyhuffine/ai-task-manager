'use client';

import { type ReactNode } from 'react';
import { useClientLocation } from '@/hooks/use-client-location';
import { cn } from '@/lib/utils';

interface DeepLinkButtonProps {
  href: string;
  label: string;
  icon?: ReactNode;
  className?: string;
  /** Show even when on a remote client. Defaults to `false` — the button
   *  silently hides off-host since the path in the URL wouldn't exist
   *  on the user's laptop. */
  alwaysShow?: boolean;
  title?: string;
}

/**
 * Anchor styled as a button, rendering only when the browser is on the
 * same machine as the app (or when explicitly forced on). Uses an
 * anchor (not a `<button>` + `window.open`) so the OS's URL handler
 * runs cleanly without popup blockers.
 */
export function DeepLinkButton({
  href,
  label,
  icon,
  className,
  alwaysShow = false,
  title,
}: DeepLinkButtonProps) {
  const location = useClientLocation();
  if (!alwaysShow && location.kind !== 'host') return null;

  return (
    <a
      href={href}
      title={title ?? label}
      className={cn(
        'inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors',
        className,
      )}
    >
      {icon}
      <span>{label}</span>
    </a>
  );
}

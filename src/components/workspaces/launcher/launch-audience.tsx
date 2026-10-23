'use client';

import { Users } from 'lucide-react';
import { useOptionalHomeContext } from '@/components/home/home-context';

/** Team audience and destination are explicit before any native chat is created. */
export function LaunchAudience() {
  const home = useOptionalHomeContext();
  if (!home || home.capabilities.privatePlanning) return null;
  return <div role="note" className="flex shrink-0 items-start gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
    <Users size={13} className="mt-0.5 shrink-0" aria-hidden />
    <span>Shared with {home.home.name}. Runs on this team&apos;s server.</span>
  </div>;
}

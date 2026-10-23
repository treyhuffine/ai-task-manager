'use client';

import { useOptionalHomeContext } from './home-context';
import { SHARED_COMPUTER_WARNING } from '@/lib/team/shared-computer-copy';

/** A visible explanation, never an extra approval or a launch block. */
export function SharedComputerWarning() {
  const home = useOptionalHomeContext();
  return home?.capabilities.configureAgents && home.sharedComputer
    ? <p role="note" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs">{SHARED_COMPUTER_WARNING}</p>
    : null;
}

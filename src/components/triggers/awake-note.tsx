'use client';

/**
 * "Runs when MacBook is awake" (P3.4, spec §7). Schedules run on the home,
 * and a home on a laptop runs them only while the laptop is awake. An
 * overdue one runs once when it wakes, not once per missed time. This only
 * explains the one scheduler there is, so nothing shows unless the home is
 * a laptop.
 */

import { useLaptopHome } from '@/hooks/use-devices';
import { cn } from '@/lib/utils';
import { Tip } from '@/components/ui/tip';

export function AwakeNote({ lead = 'Runs', className }: { lead?: string; className?: string }) {
  const laptop = useLaptopHome();
  if (!laptop) return null;
  return (
    <Tip label="Missed times while it sleeps run once when it wakes.">
      <p
        className={cn('text-[11px] text-muted-foreground/85', className)}
      >
        {lead} when {laptop.name} is awake.
      </p>
    </Tip>
  );
}

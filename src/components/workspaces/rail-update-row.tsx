'use client';

import { useQuery } from '@tanstack/react-query';
import { CircleArrowUp } from 'lucide-react';
import { openSettings } from '@/components/settings/settings-store';
import { Tip } from '@/components/ui/tip';
import { serviceStatusQuery } from '@/hooks/use-service-status';
import { railUpdateNotice } from '@/lib/service/update-presentation';
import { RailIconButton } from './rail-icon-button';

/**
 * An update that is installed and waiting on running work (`ri update`, or an
 * automatic one waiting for quiet). Nothing else in the window says so until
 * the 1-minute heads-up, so the rail keeps one quiet row near Settings for as
 * long as it waits, and it leads to Settings, Updates, which has Update now
 * and end them. No banner and no popup. It goes away when the Home switches.
 */
export function RailUpdateRow({ collapsed }: { collapsed: boolean }) {
  // ServiceConnection keeps this entry current, so the interval is a fallback.
  const { data } = useQuery(serviceStatusQuery(60_000));
  const detail = data ? railUpdateNotice({ canUseUpdates: data.canUseUpdates, update: 'update' in data ? data.update : undefined }) : null;
  if (!detail) return null;
  const open = () => openSettings('updates');
  if (collapsed) return <RailIconButton icon={CircleArrowUp} label={`Update ready. ${detail}`} onClick={open} className="text-primary" />;
  return (
    <Tip label={detail} onlyWhenTextHidden>
      <button
        type="button"
        onClick={open}
        className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <CircleArrowUp size={14} className="shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium text-foreground">Update ready</span>
          <span className="block truncate text-[10.5px] text-muted-foreground">{detail}</span>
        </span>
      </button>
    </Tip>
  );
}

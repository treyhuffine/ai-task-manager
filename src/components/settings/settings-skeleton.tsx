import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Shimmer placeholder for settings panes that fetch on open. Generic on
 * purpose — a consistent loading shape across every tab beats per-pane
 * pixel-matching, and a skeleton reads as "content is coming" rather than the
 * dead-stop feel of a centered spinner.
 */
export function SettingsSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

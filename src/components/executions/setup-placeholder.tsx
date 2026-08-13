'use client';

import { FileSkeleton, TreeRowsSkeleton } from './skeletons';

/**
 * Cover for the file tree and viewer columns while the worktree is being
 * created (or failed and is awaiting a retry click on the SetupCard).
 * The same skeletons those columns use once they're mounted, plus a
 * one-line status label — so provisioning, loading and "file still
 * fetching" are one continuous shape rather than three different
 * waiting screens.
 *
 * Pass `variant="tree"` for tree rows and `variant="viewer"` for a file.
 */
export function SetupPlaceholder({
  variant,
  label,
  animated = true,
}: {
  variant: 'tree' | 'viewer';
  label: string;
  /** Animate the skeleton. Off in the failed-setup case where motion
   *  would falsely imply work is in flight. */
  animated?: boolean;
}) {
  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="min-h-0 flex-1">
        {variant === 'tree' ? (
          <TreeRowsSkeleton animated={animated} />
        ) : (
          <FileSkeleton header animated={animated} />
        )}
      </div>
      <div className="flex-shrink-0 border-t border-border px-3 py-2 text-[11px] text-muted-foreground/80">
        {label}
      </div>
    </div>
  );
}

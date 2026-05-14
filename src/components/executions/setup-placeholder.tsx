'use client';

/**
 * Empty-state cover for the file tree and viewer columns while the
 * worktree is being created (or failed and is awaiting a retry click on
 * the SetupCard). Three pulsing skeleton bars over a one-line label —
 * communicates "list rows are coming" without using a spinner.
 *
 * Used in both columns; pass `variant="tree"` for a list-row skeleton
 * and `variant="viewer"` for a code-content skeleton.
 */
export function SetupPlaceholder({
  variant,
  label,
  animated = true,
}: {
  variant: 'tree' | 'viewer';
  label: string;
  /** Animate the skeleton bars. Off in the failed-setup case where
   *  motion would falsely imply work is in flight. */
  animated?: boolean;
}) {
  const bars = variant === 'tree' ? TREE_BARS : VIEWER_BARS;
  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex-1 min-h-0 px-3 py-3 space-y-2 overflow-hidden">
        {bars.map((width, i) => (
          <div
            key={i}
            className={`h-2 rounded bg-muted ${animated ? 'animate-pulse' : 'opacity-50'}`}
            style={{
              width,
              // Stagger the per-bar pulse offset so they breathe in a
              // wave rather than blinking in unison.
              animationDelay: animated ? `${i * 120}ms` : undefined,
              animationDuration: animated ? '1.4s' : undefined,
            }}
          />
        ))}
      </div>
      <div className="flex-shrink-0 border-t border-border px-3 py-2 text-[11px] text-muted-foreground/80">
        {label}
      </div>
    </div>
  );
}

// Rough mocks of what tree / viewer rows look like — non-uniform widths
// so they read as content rather than a regular grid.
const TREE_BARS = ['65%', '40%', '78%', '55%', '70%', '32%', '60%', '48%', '72%', '38%', '66%'];
const VIEWER_BARS = ['82%', '54%', '88%', '40%', '76%', '62%', '90%', '46%', '70%', '58%', '84%', '36%'];

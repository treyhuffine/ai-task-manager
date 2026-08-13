'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Shared loading skeletons for the execution view's worktree columns.
 *
 * One module so every "this pane is loading" moment reads the same:
 * the full-view `<ExecutionSkeleton>` on a cold session, the file tree
 * waiting on its first listing, and the viewer waiting on file content.
 * When these drifted apart the transition between them flickered, since
 * a tree that swapped bar widths mid-load looked like a re-render rather
 * than the same skeleton persisting.
 *
 * Metrics are copied from the real components on purpose (row height,
 * indent step, gutter width) so the swap to content lands in place
 * instead of nudging rows around.
 */

/**
 * One shimmer bar. Wraps the shadcn `Skeleton` to add a width, a height
 * class and a stagger offset — bars pulsing in unison read as a single
 * blinking block, while a wave reads as a list of separate things.
 * `rounded` overrides the primitive's `rounded-xl`, which turns a 2px
 * bar into a pill.
 */
export function SkeletonBar({
  w,
  h = 'h-2.5',
  delayMs = 0,
  animated = true,
  className,
}: {
  w: string;
  h?: string;
  delayMs?: number;
  /** Off where motion would imply work is in flight when it isn't
   *  (a failed worktree setup waiting on a retry click). */
  animated?: boolean;
  className?: string;
}) {
  return (
    <Skeleton
      className={cn('rounded', h, !animated && 'animate-none opacity-50', className)}
      style={{
        width: w,
        animationDelay: animated && delayMs ? `${delayMs}ms` : undefined,
        animationDuration: animated ? '1.4s' : undefined,
      }}
    />
  );
}

/** Square block for the icon/gutter marks that sit beside a bar. */
function SkeletonBlock({
  className,
  delayMs = 0,
  animated = true,
}: {
  className?: string;
  delayMs?: number;
  animated?: boolean;
}) {
  return (
    <Skeleton
      className={cn(className, !animated && 'animate-none opacity-50')}
      style={{
        animationDelay: animated && delayMs ? `${delayMs}ms` : undefined,
        animationDuration: animated ? '1.4s' : undefined,
      }}
    />
  );
}

// ─── file tree ─────────────────────────────────────────────────

interface TreeRow {
  width: string;
  depth: number;
}

/**
 * Tree rows at mixed depths. `py-1` + a 12px icon matches
 * `TreeEntryRow`, and `paddingLeft: 6 + depth * 12` is that component's
 * indent formula, so the first real listing paints over this without
 * shifting.
 */
export function TreeRowsSkeleton({
  rows = TREE_ROWS,
  animated = true,
  className,
}: {
  rows?: readonly TreeRow[];
  animated?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn('h-full overflow-hidden py-1', className)}
      aria-hidden
    >
      {rows.map(({ width, depth }, i) => (
        <div
          key={i}
          // `min-h-6` is the real row height: py-1 around a 12px icon and
          // a 12px/16px-leading label. Without it the skeleton rows sit
          // tighter than the listing and everything jumps on arrival.
          className="flex min-h-6 items-center gap-1.5 py-1 pr-2"
          style={{ paddingLeft: 6 + depth * 12 }}
        >
          <SkeletonBlock
            className="h-3 w-3 shrink-0 rounded-sm"
            delayMs={i * 70}
            animated={animated}
          />
          <SkeletonBar w={width} h="h-2" delayMs={i * 70} animated={animated} />
        </div>
      ))}
    </div>
  );
}

/** Folder-ish rows near the top, files nested under them. */
const TREE_ROWS: readonly TreeRow[] = [
  { width: '52%', depth: 0 },
  { width: '64%', depth: 1 },
  { width: '46%', depth: 2 },
  { width: '58%', depth: 2 },
  { width: '40%', depth: 1 },
  { width: '68%', depth: 1 },
  { width: '44%', depth: 2 },
  { width: '56%', depth: 2 },
  { width: '38%', depth: 0 },
  { width: '62%', depth: 1 },
  { width: '48%', depth: 1 },
  { width: '54%', depth: 0 },
  { width: '42%', depth: 1 },
  { width: '60%', depth: 1 },
];

// ─── file viewer ───────────────────────────────────────────────

type FileSkeletonVariant = 'code' | 'prose' | 'split';

/**
 * A file's worth of shimmer.
 *
 * `code` — line-number gutter plus indented lines, matching `FileView`.
 * `prose` — a heading and paragraph blocks for rendered markdown.
 * `split` — two code panes side by side, matching the CM6 merge view.
 *
 * `header` draws a faux path strip on top. Pass it only where no real
 * header is mounted above the skeleton (the no-file-selected case);
 * inside `FileViewer` the real header is already there and a second one
 * would double the strip.
 */
export function FileSkeleton({
  variant = 'code',
  header = false,
  animated = true,
  className,
}: {
  variant?: FileSkeletonVariant;
  header?: boolean;
  animated?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn('flex h-full w-full flex-col bg-background', className)}
      aria-hidden
    >
      {header && (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3">
          <SkeletonBlock className="h-3 w-3 shrink-0 rounded-sm" animated={animated} />
          <SkeletonBar w="34%" h="h-2" delayMs={60} animated={animated} />
          <div className="flex-1" />
          <SkeletonBar w="38px" h="h-3" delayMs={120} animated={animated} />
          <SkeletonBar w="14px" h="h-3" delayMs={180} animated={animated} />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        {variant === 'prose' ? (
          <ProseLines animated={animated} />
        ) : variant === 'split' ? (
          <div className="flex h-full">
            <div className="min-w-0 flex-1 border-r border-border/60">
              <CodeLines animated={animated} />
            </div>
            <div className="min-w-0 flex-1">
              <CodeLines offset={3} animated={animated} />
            </div>
          </div>
        ) : (
          <CodeLines animated={animated} />
        )}
      </div>
    </div>
  );
}

/**
 * Gutter + source lines. `offset` rotates the width pattern so the two
 * panes of a split view don't render as mirror images of each other,
 * which is what a diff of a file against itself would look like.
 */
function CodeLines({
  offset = 0,
  animated = true,
}: {
  offset?: number;
  animated?: boolean;
}) {
  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex flex-col gap-1.5 border-r border-border/40 px-2 py-3">
        {CODE_LINES.map((_, i) => (
          <SkeletonBlock
            key={i}
            className="h-2 w-3 rounded bg-muted/60"
            delayMs={i * 60}
            animated={animated}
          />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 py-3">
        {CODE_LINES.map((_, i) => (
          <div
            key={i}
            className="flex items-center"
            style={{ paddingLeft: indentForCodeLine(i) }}
          >
            <SkeletonBar
              w={CODE_LINES[(i + offset) % CODE_LINES.length]}
              h="h-2"
              delayMs={i * 60}
              animated={animated}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Rendered-markdown shape: a title, then paragraphs with a short last line. */
function ProseLines({ animated = true }: { animated?: boolean }) {
  return (
    <div className="h-full overflow-hidden px-5 py-4">
      <SkeletonBar w="46%" h="h-4" className="mb-4" animated={animated} />
      {PROSE_BLOCKS.map((block, b) => (
        <div key={b} className="mb-5 space-y-2">
          {block.map((w, i) => (
            <SkeletonBar
              key={i}
              w={w}
              h="h-2"
              delayMs={(b * 4 + i) * 60}
              animated={animated}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

const CODE_LINES = [
  '52%', '70%', '40%', '64%', '58%', '78%',
  '36%', '62%', '74%', '48%', '66%', '54%',
  '70%', '42%', '58%', '64%', '38%', '68%',
];

const PROSE_BLOCKS = [
  ['96%', '88%', '92%', '54%'],
  ['90%', '95%', '72%'],
  ['93%', '86%', '90%', '48%'],
];

// Stagger indent like real source — the first and last lines hug the
// gutter, the middle steps in and out as if inside a function body.
function indentForCodeLine(i: number): number {
  if (i < 2) return 0;
  if (i < 4) return 12;
  if (i < 11) return 24;
  if (i < 15) return 12;
  return 0;
}

'use client';

// `Bar` is the shared primitive under its local name — the chat and header
// skeletons below were written against it.
import { SkeletonBar as Bar } from './skeletons';

/**
 * Loading skeleton that mirrors the ExecutionView's shape so the transition
 * from "loading…" to "loaded" is a content swap rather than a reshuffle:
 * the header, then the chat with the floating tools box on its right.
 * Phones (< lg) get the chat alone, like the real view.
 *
 * The internal skeletons use Tailwind `animate-pulse` and are intentionally
 * low-detail: the goal is structural shape recognition, not photo-realism.
 */
export function ExecutionSkeleton() {
  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      <div className="lg:hidden flex flex-1 min-w-0 min-h-0">
        <ChatColumn />
      </div>

      <div className="hidden lg:flex flex-col flex-1 min-w-0 min-h-0">
        <HeaderBar />
        <div className="relative flex flex-1 min-w-0 min-h-0">
          <ChatColumn />
          <ToolsBoxSkeleton />
        </div>
      </div>
    </div>
  );
}

// ─── header ────────────────────────────────────────────────────

function HeaderBar() {
  return (
    <div className="flex h-11 items-center gap-3 border-b border-border px-3 min-w-0">
      <Bar w="72px" />
      <Bar w="160px" />
      <Bar w="84px" h="h-2" />
      <div className="flex-1" />
      <Bar w="72px" />
      <Bar w="56px" />
      <div className="h-7 w-44 rounded-lg bg-muted/40 animate-pulse" />
    </div>
  );
}

// ─── tools box ─────────────────────────────────────────────────

function ToolsBoxSkeleton() {
  return (
    <div className="absolute right-4 top-12 w-[288px] rounded-2xl bg-card p-2.5 shadow-[0_12px_32px_rgba(0,0,0,0.28)] space-y-3">
      <Bar w="45%" h="h-2" />
      <div className="h-10 rounded-lg bg-muted/40 animate-pulse" />
      {[70, 60, 40, 50, 64, 52].map((w, i) => (
        <div key={i} className="flex items-center gap-2.5 px-1">
          <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
          <Bar w={`${w}%`} h="h-2" delayMs={i * 60} />
        </div>
      ))}
    </div>
  );
}

// ─── chat column ───────────────────────────────────────────────

function ChatColumn() {
  return (
    <div className="flex h-full w-full flex-col bg-background min-w-0">
      {/* Transcript — assistant messages render as flowing text lines
          (no bubble; matches the real transcript), user messages are
          right-aligned rounded bubbles that hug their content. */}
      <div className="flex-1 min-h-0 overflow-hidden px-4 py-4 space-y-5">
        <AssistantText lines={['94%', '88%', '76%']} />
        <UserBubble lines={['180px', '120px']} />
        <AssistantText lines={['96%', '85%', '92%', '78%', '64%']} />
        <UserBubble lines={['100px']} />
        <AssistantText lines={['88%', '92%', '70%']} />
      </div>
      {/* Composer — text input + send button shape. */}
      <div className="flex-shrink-0 border-t border-border p-3">
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <Bar w="35%" h="h-2" />
          <div className="flex items-center justify-between pt-1">
            <Bar w="80px" h="h-2" />
            <div className="h-6 w-6 rounded-md bg-muted animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Assistant skeleton — bare lines of "text", full column width. No
 * background, no rounded container; the real transcript renders
 * assistant turns as flowing prose, so the skeleton should too.
 */
function AssistantText({ lines }: { lines: string[] }) {
  return (
    <div className="w-full space-y-1.5">
      {lines.map((w, i) => (
        <Bar key={i} w={w} h="h-2" delayMs={i * 60} />
      ))}
    </div>
  );
}

/**
 * User skeleton — right-aligned rounded blob that auto-sizes to its
 * widest bar. Bars use pixel widths (not %) so the bubble's
 * `w-fit`-style sizing works against fixed numbers; without that the
 * % bars and % bubble would race each other to nothing and the bubble
 * would shrink to a tiny strip.
 */
function UserBubble({ lines }: { lines: string[] }) {
  return (
    <div className="flex w-full justify-end">
      <div className="rounded-2xl bg-primary/10 px-3.5 py-2.5 space-y-1.5 max-w-[70%]">
        {lines.map((w, i) => (
          <Bar key={i} w={w} h="h-2" delayMs={i * 90} />
        ))}
      </div>
    </div>
  );
}

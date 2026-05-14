'use client';

import type { Layout } from 'react-resizable-panels';
import {
  HORIZONTAL_PANEL_IDS,
  VERTICAL_PANEL_IDS,
} from '@/hooks/use-execution-layout-sizes';
import { cn } from '@/lib/utils';

interface ExecutionSkeletonProps {
  /** Same horizontal layout the real ExecutionView feeds to its
   *  ResizablePanelGroup — `useExecutionLayoutSizes(sessionId).horizontal`. */
  horizontal: Layout;
  /** Same vertical layout — drives the viewer/terminal split inside the
   *  right column. */
  vertical: Layout;
}

/**
 * Loading skeleton that mirrors the ExecutionView's column structure so
 * the transition from "loading…" to "loaded" is a content swap rather
 * than a layout reshuffle. Reads the user's persisted column / row
 * sizes (or sensible defaults) and lays out three skeleton panels at
 * those widths — chat, tree, viewer+terminal — separated by the same
 * borders the real view uses. Mobile (< lg) collapses to chat only,
 * matching the real view's responsive behavior.
 *
 * The internal skeletons (header bar, chat bubbles, tree rows, code
 * lines) use Tailwind `animate-pulse` and are intentionally low-detail
 * — the goal is structural shape recognition, not photo-realism.
 */
export function ExecutionSkeleton({ horizontal, vertical }: ExecutionSkeletonProps) {
  const chatPct = horizontal[HORIZONTAL_PANEL_IDS.chat] ?? 40;
  const treePct = horizontal[HORIZONTAL_PANEL_IDS.tree] ?? 18;
  const rightPct = horizontal[HORIZONTAL_PANEL_IDS.right] ?? 42;

  const viewerPct = vertical[VERTICAL_PANEL_IDS.viewer] ?? 70;
  const terminalPct = vertical[VERTICAL_PANEL_IDS.terminal] ?? 30;

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      {/* Mobile (< lg): single chat column, no header / side columns —
          mirrors the responsive single-pane variant of ExecutionView. */}
      <div className="lg:hidden flex flex-1 min-w-0 min-h-0">
        <ChatColumn />
      </div>

      {/* Desktop (>= lg): full header + 3 columns. */}
      <div className="hidden lg:flex flex-col flex-1 min-w-0 min-h-0">
        <HeaderBar />
        <div className="flex flex-1 min-w-0 min-h-0">
          <div
            style={{ width: `${chatPct}%` }}
            className="flex flex-col min-w-0 border-r border-border"
          >
            <ChatColumn />
          </div>
          <div
            style={{ width: `${treePct}%` }}
            className="flex flex-col min-w-0 border-r border-border"
          >
            <TreeColumn />
          </div>
          <div style={{ width: `${rightPct}%` }} className="flex flex-col min-w-0">
            <div
              style={{ height: `${viewerPct}%` }}
              className="min-h-0 border-b border-border"
            >
              <ViewerColumn />
            </div>
            <div style={{ height: `${terminalPct}%` }} className="min-h-0">
              <TerminalColumn />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── header ────────────────────────────────────────────────────

function HeaderBar() {
  return (
    <div className="flex items-center gap-3 border-b border-border px-3 py-2 min-w-0">
      <Bar w="60px" />
      <Bar w="120px" />
      <div className="flex-1" />
      <Bar w="48px" />
      <Bar w="56px" />
      <Bar w="20px" />
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

// ─── tree column ───────────────────────────────────────────────

function TreeColumn() {
  return (
    <div className="flex h-full w-full flex-col bg-background min-w-0">
      {/* Title row */}
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <Bar w="36px" h="h-2" />
        <Bar w="80px" h="h-3" />
      </div>
      {/* Diff/All toggle row */}
      <div className="border-b border-border px-2 py-1">
        <div className="h-5 w-full rounded-md bg-muted/40 animate-pulse" />
      </div>
      {/* Search bar */}
      <div className="border-b border-border px-2 py-1.5">
        <Bar w="60%" h="h-2" />
      </div>
      {/* Rows — indented bars at varied depths so it reads as a tree. */}
      <div className="flex-1 min-h-0 overflow-hidden px-2 py-2 space-y-1.5">
        {TREE_ROWS.map(({ width, indent }, i) => (
          <div
            key={i}
            className="flex items-center gap-1.5"
            style={{ paddingLeft: indent }}
          >
            <div
              className="h-2.5 w-2.5 rounded-sm bg-muted animate-pulse"
              style={{ animationDelay: `${i * 70}ms`, animationDuration: '1.4s' }}
            />
            <Bar w={width} delayMs={i * 70} />
          </div>
        ))}
      </div>
    </div>
  );
}

const TREE_ROWS = [
  { width: '70%', indent: 0 },
  { width: '60%', indent: 12 },
  { width: '78%', indent: 24 },
  { width: '52%', indent: 24 },
  { width: '66%', indent: 12 },
  { width: '40%', indent: 0 },
  { width: '72%', indent: 12 },
  { width: '58%', indent: 24 },
  { width: '64%', indent: 24 },
  { width: '50%', indent: 12 },
  { width: '74%', indent: 0 },
  { width: '46%', indent: 12 },
];

// ─── viewer column ─────────────────────────────────────────────

function ViewerColumn() {
  return (
    <div className="flex h-full w-full flex-col bg-background min-w-0">
      {/* File path bar + a couple of action affordances on the right. */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <div className="h-2.5 w-2.5 rounded-sm bg-muted animate-pulse" />
        <Bar w="38%" h="h-2" />
        <div className="flex-1" />
        <Bar w="40px" h="h-3" />
        <Bar w="14px" h="h-3" />
        <Bar w="14px" h="h-3" />
      </div>
      {/* Code lines — narrow line numbers + variable-width content. */}
      <div className="flex-1 min-h-0 overflow-hidden flex">
        <div className="flex flex-col gap-1.5 px-2 py-3 border-r border-border/40">
          {VIEWER_LINES.map((_, i) => (
            <div
              key={i}
              className="h-2 w-3 rounded bg-muted/60 animate-pulse"
              style={{ animationDelay: `${i * 60}ms`, animationDuration: '1.4s' }}
            />
          ))}
        </div>
        <div className="flex-1 flex flex-col gap-1.5 px-3 py-3 min-w-0">
          {VIEWER_LINES.map((w, i) => (
            <div
              key={i}
              className="flex items-center gap-2"
              style={{ paddingLeft: indentForCodeLine(i) }}
            >
              <Bar w={w} delayMs={i * 60} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const VIEWER_LINES = [
  '52%', '70%', '40%', '64%', '58%', '78%',
  '36%', '62%', '74%', '48%', '66%', '54%',
  '70%', '42%', '58%', '64%',
];

// Stagger indent like real source code — first/last lines hug the gutter,
// middle lines step in/out as if inside a function body.
function indentForCodeLine(i: number): number {
  if (i < 2) return 0;
  if (i < 4) return 12;
  if (i < 10) return 24;
  if (i < 14) return 12;
  return 0;
}

// ─── terminal column ───────────────────────────────────────────

function TerminalColumn() {
  return (
    <div className="flex h-full w-full flex-col bg-background min-w-0">
      {/* Tab strip */}
      <div className="flex items-center gap-2 border-b border-border px-2 py-1">
        <Bar w="48px" h="h-2.5" />
        <Bar w="48px" h="h-2.5" />
        <div className="flex-1" />
        <Bar w="14px" h="h-3" />
      </div>
      {/* Faux prompt lines */}
      <div className="flex-1 min-h-0 overflow-hidden px-3 py-2 space-y-1.5">
        {TERMINAL_LINES.map((w, i) => (
          <div key={i} className="flex items-center gap-2">
            <Bar w="10px" h="h-2" />
            <Bar w={w} h="h-2" delayMs={i * 80} />
          </div>
        ))}
      </div>
    </div>
  );
}

const TERMINAL_LINES = ['62%', '40%', '78%', '48%', '70%'];

// ─── primitives ────────────────────────────────────────────────

function Bar({
  w,
  h = 'h-2.5',
  delayMs = 0,
}: {
  w: string;
  h?: string;
  delayMs?: number;
}) {
  return (
    <div
      className={cn('rounded bg-muted animate-pulse', h)}
      style={{
        width: w,
        animationDelay: delayMs ? `${delayMs}ms` : undefined,
        animationDuration: '1.4s',
      }}
    />
  );
}

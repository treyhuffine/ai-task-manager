'use client';

import type { Layout } from 'react-resizable-panels';
import {
  HORIZONTAL_PANEL_IDS,
  VERTICAL_PANEL_IDS,
} from '@/hooks/use-execution-layout-sizes';
// `Bar` is the shared primitive under its local name — the chat, header
// and terminal skeletons below were written against it, and aliasing
// keeps them on the same bar as the tree and viewer columns.
import { FileSkeleton, SkeletonBar as Bar, TreeRowsSkeleton } from './skeletons';

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
      {/* Rows — shared with the tree column's own loading state, so a
          cold open that resolves the session before the tree listing
          keeps the same rows on screen instead of re-shuffling them. */}
      <div className="flex-1 min-h-0">
        <TreeRowsSkeleton />
      </div>
    </div>
  );
}

// ─── viewer column ─────────────────────────────────────────────

/**
 * Viewer column: the shared file skeleton, header strip included. Same
 * component the viewer itself falls back to, so the handoff from this
 * full-view skeleton to the real column is invisible when the session
 * resolves before the file does.
 */
function ViewerColumn() {
  return <FileSkeleton header />;
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

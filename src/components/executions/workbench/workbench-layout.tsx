'use client';

import { useRef, type ReactNode } from 'react';
import { MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FolderSource } from '@/lib/folders/source';
import { Tip } from '@/components/ui/tip';
import { PREVIEW_HOST_ATTRIBUTE } from '@/components/chat-ui/artifacts/artifact-preview-store';
import { ResizeHandle } from './resize-handle';
import { TerminalDrawer } from './terminal-drawer';
import { DEFAULT_TERMINAL_PCT } from './use-workbench';

/**
 * The workbench's two splits, shared by the execution view and the agent
 * view so both lay out, resize and fold the same way
 * (docs/execution-view-spec.md, "Workbench layout", and
 * docs/agents-view-spec.md §10):
 *
 *   TerminalSplit   whatever is above, and the terminal drawer across the
 *                   whole bottom while it's open.
 *   PanelSplit      the chat, and the tools panel on its right. Expanded,
 *                   the panel takes the width and the chat folds to a strip.
 */

export interface TerminalSlot {
  /** Where the shells run: an execution's worktree, or an agent's own folder. */
  source: FolderSource;
  disabled: boolean;
  disabledReason?: string;
  /** The drawer fills the whole area, and what's above it hides. */
  maximized: boolean;
  onToggleMaximize: () => void;
  onHide: () => void;
  /** Its height, in % of the area. */
  pct: number;
  onCommitPct: (pct: number) => void;
}

/**
 * `children` above, the terminal drawer below while `terminal` is given
 * (null while it's closed, or where there's no terminal). The drawer mounts
 * only while open. Hiding it never kills a shell: the PTYs live on the
 * server and reattach with their output.
 */
export function TerminalSplit({ children, terminal }: { children: ReactNode; terminal: TerminalSlot | null }) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const maximized = !!terminal?.maximized;
  return (
    <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
      <div className={cn('relative flex min-h-0 flex-1 flex-col', maximized && 'hidden')}>{children}</div>
      {terminal && (
        <>
          {!maximized && (
            <ResizeHandle
              axis="rows"
              targetRef={drawerRef}
              containerRef={bodyRef}
              pct={terminal.pct}
              minPct={12}
              maxPct={80}
              minOtherPx={200}
              minTargetPx={120}
              defaultPct={DEFAULT_TERMINAL_PCT}
              onCommit={terminal.onCommitPct}
              label="Resize the terminal"
            />
          )}
          <div
            ref={drawerRef}
            style={maximized ? undefined : { height: `${terminal.pct}%` }}
            className={cn('min-h-0', maximized ? 'flex-1' : 'flex-shrink-0')}
          >
            <TerminalDrawer
              source={terminal.source}
              disabled={terminal.disabled}
              disabledReason={terminal.disabledReason}
              maximized={maximized}
              onToggleMaximize={terminal.onToggleMaximize}
              onHide={terminal.onHide}
            />
          </div>
        </>
      )}
    </div>
  );
}

export interface ChatStripProps {
  /** The chat's name, written down the strip. */
  label: string;
  /** A dot while the chat works or waits on you. */
  status: 'working' | 'needsInput' | null;
  onRestore: () => void;
}

/** What the chat folds to while the panel is expanded: a way back, its state and its name. */
export function ChatStrip({ label, status, onRestore }: ChatStripProps) {
  return (
    <div className="flex w-11 flex-shrink-0 flex-col items-center gap-2 border-r border-border py-2">
      <Tip label="Bring the chat back" shortcut="Esc">
        <button
          type="button"
          onClick={onRestore}
          aria-label="Bring the chat back"
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <MessageSquare size={15} />
        </button>
      </Tip>
      {status && (
        <Tip label={status === 'needsInput' ? 'This chat needs input' : 'This chat is working'}>
          <span
            aria-label={status === 'needsInput' ? 'Needs input' : 'Working'}
            className={cn('h-1.5 w-1.5 animate-pulse rounded-full', status === 'needsInput' ? 'bg-amber-500' : 'bg-emerald-500')}
          />
        </Tip>
      )}
      <span className="mt-1 max-h-60 truncate text-[11.5px] text-muted-foreground [writing-mode:vertical-rl] rotate-180">
        {label}
      </span>
    </div>
  );
}

export interface PanelSlot {
  open: boolean;
  /** The panel has the width, and the chat folds to its strip. */
  maximized: boolean;
  /**
   * The panel. Null unmounts it. Given while closed, it stays mounted and
   * hidden, so what's in it (a draft, a loaded page) survives.
   */
  content: ReactNode;
  /** Its width, in % of the row. */
  pct: number;
  defaultPct: number;
  onCommitPct: (pct: number) => void;
}

/**
 * The chat on the left and the tools panel on the right, with a drag
 * handle between them. The chat column is the `@container/chat` a floating
 * tools box sizes by, and `chatHost` names the surface a file from the chat
 * opens beside (`PREVIEW_HOST_ATTRIBUTE`).
 */
export function PanelSplit({
  chat,
  chatHost,
  chatStrip,
  panel,
}: {
  chat: ReactNode;
  chatHost: string;
  chatStrip: ChatStripProps;
  panel: PanelSlot;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const maximized = panel.open && panel.maximized;
  return (
    <div ref={rowRef} className="relative flex min-h-0 flex-1">
      {maximized && <ChatStrip key="strip" {...chatStrip} />}
      <div
        key="chat"
        {...{ [PREVIEW_HOST_ATTRIBUTE]: chatHost }}
        className={cn('@container/chat relative flex min-h-0 min-w-0 flex-1 flex-col bg-background', maximized && 'hidden')}
      >
        {chat}
      </div>
      {panel.content && (
        <>
          {panel.open && !maximized && (
            <ResizeHandle
              key="split"
              axis="columns"
              targetRef={panelRef}
              containerRef={rowRef}
              pct={panel.pct}
              minPct={25}
              maxPct={80}
              minOtherPx={340}
              minTargetPx={380}
              defaultPct={panel.defaultPct}
              onCommit={panel.onCommitPct}
              label="Resize the panel"
            />
          )}
          <div
            key="panel"
            ref={panelRef}
            style={maximized ? undefined : { width: `${panel.pct}%` }}
            className={cn('min-h-0 min-w-0', maximized ? 'flex-1' : 'flex-shrink-0', !panel.open && 'hidden')}
          >
            {panel.content}
          </div>
        </>
      )}
    </div>
  );
}

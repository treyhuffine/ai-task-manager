'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Terminal as TerminalIcon, X } from 'lucide-react';
import { useTerminals, useCreateTerminal, useKillTerminal } from '@/hooks/use-terminals';
import { ExecutionTerminalInstance } from './execution-terminal-instance';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ExecutionTerminalPanelProps {
  sessionId: string;
  /** Hide entirely — used while the worktree is still provisioning. */
  disabled?: boolean;
  disabledReason?: string;
  /**
   * True when the wrapping resizable panel is at its collapsed size
   * (tab strip only). Drives the chevron icon and hides the content
   * area so xterm doesn't fight with the tiny container.
   */
  collapsed?: boolean;
  /** Toggle the wrapping panel between collapsed and expanded states. */
  onToggleCollapsed?: () => void;
}

/**
 * Terminal pane that lives in the bottom slot of the right-side
 * resizable column. The resizable handle controls visibility now — drag
 * it shut to hide the terminal, drag it open to reveal it. There's no
 * explicit open/close button on the panel itself.
 *
 * The first terminal auto-creates when the panel first becomes
 * non-zero-height so the user lands on a usable shell without
 * extra clicks.
 */
export function ExecutionTerminalPanel({
  sessionId,
  disabled,
  disabledReason,
  collapsed,
  onToggleCollapsed,
}: ExecutionTerminalPanelProps) {
  const { data: terminals = [], isLoading } = useTerminals(sessionId);
  const createTerminal = useCreateTerminal(sessionId);
  const killTerminal = useKillTerminal(sessionId);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Auto-create the first terminal once the panel mounts and isn't
  // disabled. Skip when collapsed — no point spinning a PTY for a
  // panel the user hasn't expanded yet. Skip when a previous attempt
  // errored — otherwise we'd hammer the API. The user can retry from
  // the error state.
  useEffect(() => {
    if (disabled || isLoading || collapsed) return;
    if (terminals.length > 0) return;
    if (createTerminal.isPending || createTerminal.isError) return;
    createTerminal.mutate({ cols: 80, rows: 24 });
  }, [disabled, isLoading, collapsed, terminals.length, createTerminal]);

  // Keep the active tab pointing at something real.
  useEffect(() => {
    if (terminals.length === 0) {
      if (activeId !== null) setActiveId(null);
      return;
    }
    if (!activeId || !terminals.some((t) => t.id === activeId)) {
      setActiveId(terminals[terminals.length - 1].id);
    }
  }, [terminals, activeId]);

  const handleNew = () => {
    if (createTerminal.isPending) return;
    createTerminal.reset();
    createTerminal.mutate(
      { cols: 80, rows: 24 },
      { onSuccess: (created) => setActiveId(created.id) },
    );
  };

  const createErrorMessage = (() => {
    const err = createTerminal.error;
    if (!err) return null;
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      return body?.error ?? `Couldn't start terminal (HTTP ${err.status}).`;
    }
    return err instanceof Error ? err.message : String(err);
  })();

  const handleClose = (id: string) => {
    killTerminal.mutate(id);
  };

  if (disabled) {
    return (
      <div className="flex h-full w-full items-center gap-2 border-t border-border bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground/60">
        <TerminalIcon size={12} />
        <span>{disabledReason ?? 'Terminal unavailable'}</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#0b0b0c]">
      {/* tab strip — always visible. In collapsed mode this is the
          entire panel; clicking the chevron expands the content. */}
      <div className="flex items-center gap-0.5 border-y border-zinc-800 bg-zinc-900/60 px-1">
        <div className="flex flex-1 items-center gap-0.5 overflow-x-auto py-0.5">
          <TerminalIcon size={11} className="mx-1 text-zinc-500 flex-shrink-0" />
          {terminals.map((t, i) => (
            <TerminalTab
              key={t.id}
              label={`Terminal ${i + 1}`}
              active={activeId === t.id}
              onActivate={() => {
                setActiveId(t.id);
                if (collapsed && onToggleCollapsed) onToggleCollapsed();
              }}
              onClose={() => handleClose(t.id)}
            />
          ))}
          {!collapsed && (
            <button
              type="button"
              onClick={handleNew}
              disabled={createTerminal.isPending}
              className="ml-0.5 inline-flex size-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
              title="New terminal"
              aria-label="New terminal"
            >
              <Plus size={12} />
            </button>
          )}
        </div>
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="inline-flex size-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 flex-shrink-0"
            title={collapsed ? 'Expand terminal' : 'Collapse terminal'}
            aria-label={collapsed ? 'Expand terminal' : 'Collapse terminal'}
          >
            {collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        )}
      </div>

      {/* content area — every terminal stays mounted; only one is visible */}
      <div className={cn('relative flex-1 min-h-0', collapsed && 'hidden')}>
        {terminals.map((t) => (
          <div
            key={t.id}
            className={cn(
              'absolute inset-0',
              activeId === t.id ? 'visible' : 'invisible pointer-events-none',
            )}
          >
            <ExecutionTerminalInstance
              sessionId={sessionId}
              terminalId={t.id}
              active={activeId === t.id}
              onExit={() => handleClose(t.id)}
            />
          </div>
        ))}
        {terminals.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-[12px] text-zinc-500">
            {createErrorMessage ? (
              <>
                <span className="text-zinc-300">Couldn&apos;t start terminal</span>
                <span className="max-w-md text-zinc-500">{createErrorMessage}</span>
                <button
                  type="button"
                  onClick={handleNew}
                  className="mt-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-1 text-[11px] text-zinc-100 hover:bg-zinc-700"
                >
                  Retry
                </button>
              </>
            ) : createTerminal.isPending || isLoading ? (
              <span>Starting terminal…</span>
            ) : (
              <span>No terminal sessions</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface TerminalTabProps {
  label: string;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
}

function TerminalTab({ label, active, onActivate, onClose }: TerminalTabProps) {
  return (
    <div
      className={cn(
        'group flex items-center rounded text-[11px] font-medium transition-colors',
        active ? 'bg-[#0b0b0c] text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100',
      )}
    >
      <button
        type="button"
        onClick={onActivate}
        className="flex items-center gap-1.5 px-2 py-1"
      >
        <TerminalIcon size={11} />
        <span>{label}</span>
      </button>
      <button
        type="button"
        onClick={onClose}
        className={cn(
          'mr-1 inline-flex size-3.5 items-center justify-center rounded text-zinc-500 hover:bg-zinc-700 hover:text-zinc-100',
          !active && 'opacity-0 group-hover:opacity-100',
        )}
        title="Close terminal"
        aria-label="Close terminal"
      >
        <X size={9} />
      </button>
    </div>
  );
}

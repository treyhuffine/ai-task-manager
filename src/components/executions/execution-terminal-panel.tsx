'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Terminal as TerminalIcon, X } from 'lucide-react';
import { useTerminals, useCreateTerminal, useKillTerminal } from '@/hooks/use-terminals';
import { ExecutionTerminalInstance } from './execution-terminal-instance';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ExecutionTerminalPanelProps {
  sessionId: string;
  /** Closed = thin strip; open = full panel. */
  open: boolean;
  onToggle: () => void;
  /** Hide entirely — used while the worktree is still provisioning. */
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Slide-up terminal dock. Lives below the chat surface, full width.
 *
 * Closed state is a thin strip with a "Terminal" label so users can
 * find it without searching the header for an icon. Open state shows a
 * tab strip (terminal 1, 2, ... with `+` to add and `×` per tab) plus
 * the active terminal pane. Inactive panes stay mounted to preserve
 * xterm scrollback and the live SSE connection.
 *
 * The first terminal auto-creates when the user opens the panel for
 * the first time — opening an empty panel is friction.
 */
export function ExecutionTerminalPanel({
  sessionId,
  open,
  onToggle,
  disabled,
  disabledReason,
}: ExecutionTerminalPanelProps) {
  const { data: terminals = [], isLoading } = useTerminals(sessionId);
  const createTerminal = useCreateTerminal(sessionId);
  const killTerminal = useKillTerminal(sessionId);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Auto-create the first terminal when the panel opens for the first
  // time. After that, the user manages count via the tab `+` / `×`.
  // Skip auto-create when a previous attempt errored — otherwise we'd
  // hammer the API in an infinite loop. The user can retry from the
  // error state.
  useEffect(() => {
    if (!open || disabled || isLoading) return;
    if (terminals.length > 0) return;
    if (createTerminal.isPending || createTerminal.isError) return;
    createTerminal.mutate({ cols: 80, rows: 24 });
  }, [open, disabled, isLoading, terminals.length, createTerminal]);

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
      <div className="flex w-full items-center gap-2 border-t border-border bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground/60">
        <TerminalIcon size={12} />
        <span>{disabledReason ?? 'Terminal unavailable'}</span>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 border-t border-border bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
      >
        <ChevronUp size={12} />
        <TerminalIcon size={12} />
        <span>Terminal</span>
        {terminals.length > 0 && (
          <span className="text-muted-foreground/60">· {terminals.length}</span>
        )}
      </button>
    );
  }

  return (
    <div className="flex h-80 flex-col border-t border-border bg-[#0b0b0c]">
      {/* tab strip */}
      <div className="flex items-center gap-0.5 border-b border-zinc-800 bg-zinc-900/60 pl-1 pr-1">
        <div className="flex flex-1 items-center gap-0.5 overflow-x-auto py-0.5">
          {terminals.map((t, i) => (
            <TerminalTab
              key={t.id}
              label={`Terminal ${i + 1}`}
              active={activeId === t.id}
              onActivate={() => setActiveId(t.id)}
              onClose={() => handleClose(t.id)}
            />
          ))}
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
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex size-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          title="Hide terminal"
          aria-label="Hide terminal"
        >
          <ChevronDown size={12} />
        </button>
      </div>

      {/* content area — every terminal stays mounted; only one is visible */}
      <div className="relative flex-1 min-h-0">
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

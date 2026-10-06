'use client';

import { Maximize2, Minimize2 } from 'lucide-react';
import { HOTKEYS } from '@/constants/commands';
import type { FolderSource } from '@/lib/folders/source';
import { ExecutionTerminalPanel } from '../execution-terminal-panel';
import { Tip } from '@/components/ui/tip';

interface TerminalDrawerProps {
  source: FolderSource;
  disabled: boolean;
  disabledReason?: string;
  maximized: boolean;
  onToggleMaximize: () => void;
  onHide: () => void;
}

/**
 * The terminal, as a drawer across the whole bottom of the execution (under
 * the chat and the panel), for commands you type yourself. It mounts only
 * while open. Hiding it never kills a shell: the PTYs live on the server,
 * and reopening reconnects to them with their output.
 */
export function TerminalDrawer({ source, disabled, disabledReason, maximized, onToggleMaximize, onHide }: TerminalDrawerProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ExecutionTerminalPanel
        source={source}
        disabled={disabled}
        disabledReason={disabledReason}
        onToggleCollapsed={onHide}
        collapseTitle="Hide the terminal. Shells keep running."
        collapseShortcut={HOTKEYS.toggleTerminal.label}
        headerExtra={
          <Tip label={maximized ? 'Restore the terminal height' : 'Expand the terminal'}>
            <button
              type="button"
              onClick={onToggleMaximize}
              className="inline-flex size-6 flex-shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              aria-label={maximized ? 'Restore the terminal height' : 'Expand the terminal'}
            >
              {maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
          </Tip>
        }
      />
    </div>
  );
}

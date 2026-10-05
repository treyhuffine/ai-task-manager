'use client';

import { ExecutionTerminalPanel } from '@/components/executions/execution-terminal-panel';
import { homeTerminals } from '@/lib/folders/source';

/**
 * Home's terminal (More, Terminal): shells on the box the home runs on,
 * opening in its home folder, for work that belongs to no agent or
 * execution. Whichever device is viewing, the shell is the box's. The
 * shells are the home's, apart from every agent's and execution's, and
 * outlive the tab: switching away or closing the page leaves them running,
 * and coming back picks them up with their output.
 */
export function HomeTerminal() {
  return (
    <div className="h-full min-h-0">
      <ExecutionTerminalPanel source={homeTerminals} />
    </div>
  );
}

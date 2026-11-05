'use client';

import { useMemo, type KeyboardEvent, type ReactNode } from 'react';
import { AgentIcon } from '@/components/agents/agent-icon';
import { useDashboard } from '@/contexts/dashboard-context';
import { useInactivity } from '@/hooks/use-inactivity';
import { useRailSessions } from '@/hooks/use-workspaces';
import type { WorkspaceWithCounts } from '@/db/types';
import { SelectAllChats } from './inactive-fold';
import { SelectionCheck, useWorkspaceSelection } from './workspace-selection-context';

/**
 * One agent while the rail selects chats to archive: the agent, then its chats
 * under it with their checkboxes, whatever the rail style shows at rest. You
 * stay on the Agents list with each agent where it was, so every chat still
 * says whose it is. An agent with no chats has nothing to tick, so it steps
 * aside until you're done.
 *
 * The agent stays in view (`--rail-sticky-top`, under the list header) while
 * its chats scroll, since a long agent's chats would otherwise scroll it away.
 *
 * Its check ticks all its chats and opens its inactive fold to show them. A
 * chat working right now is left out, since one click shouldn't stop live
 * work. Tick that row itself to archive it.
 */
export function AgentSelectionSection({
  workspace,
  sessions,
  children,
}: {
  workspace: WorkspaceWithCounts;
  /** All its active chats, folded ones included. */
  sessions: readonly { id: string }[];
  children: ReactNode;
}) {
  const selection = useWorkspaceSelection();
  const { streamingSessionIds, backgroundSessionIds } = useDashboard();
  if (!selection || sessions.length === 0) return null;

  const idle = sessions.filter((s) => !streamingSessionIds.has(s.id) && !backgroundSessionIds.has(s.id));
  const ticked = sessions.filter((s) => selection.isSelected(s.id)).length;
  const all = idle.length > 0 && idle.every((s) => selection.isSelected(s.id));
  const checked = all ? true : ticked > 0 ? 'indeterminate' : false;

  const toggleAll = () => {
    selection.setMany((all ? sessions : idle).map((s) => s.id), !all);
    if (!all) selection.setFoldsOpen([`agent:${workspace.id}`], true);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    toggleAll();
  };

  return (
    <section data-agent-id={workspace.id} aria-label={`${workspace.name} chats`}>
      <div className="sticky top-[var(--rail-sticky-top,0px)] z-20 bg-background">
        <div
          role="checkbox"
          aria-checked={checked === 'indeterminate' ? 'mixed' : checked}
          aria-label={`All ${workspace.name} chats`}
          tabIndex={0}
          onClick={toggleAll}
          onKeyDown={onKeyDown}
          className="flex cursor-pointer select-none items-center gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-muted/40"
        >
          <AgentIcon workspace={workspace} size="md" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium leading-tight text-foreground/85">{workspace.name}</span>
            <span className="mt-0.5 block truncate text-[10.5px] leading-tight text-muted-foreground/65">
              {ticked > 0
                ? `${ticked} of ${sessions.length} selected`
                : `${sessions.length} chat${sessions.length === 1 ? '' : 's'}`}
            </span>
          </span>
          <span className="flex flex-shrink-0 pr-0.5">
            <SelectionCheck checked={checked} />
          </span>
        </div>
      </div>
      <div className="mb-1.5 mt-0.5 space-y-px">{children}</div>
    </section>
  );
}

/**
 * The top of the Agents list while selecting: every inactive chat across the
 * agents in one click, for clearing out old finished work. The chat on screen
 * stays out of it, as it stays out of the folds.
 */
export function SelectAllInactive() {
  const { data: rail } = useRailSessions();
  const { isInactive } = useInactivity();
  const { activeSessionId, activeExecutionId } = useDashboard();
  const inactive = useMemo(
    () =>
      (rail?.sessions ?? []).filter(
        (s) =>
          isInactive(s) &&
          s.id !== activeSessionId &&
          !(!!s.executionId && s.executionId === activeExecutionId),
      ),
    [rail?.sessions, isInactive, activeSessionId, activeExecutionId],
  );
  if (inactive.length === 0) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/40 py-0.5 pl-3 pr-2 text-[10px]">
      <span className="truncate text-muted-foreground/60">
        {inactive.length} inactive chat{inactive.length === 1 ? '' : 's'}
      </span>
      <SelectAllChats
        ids={inactive.map((s) => s.id)}
        folds={[...new Set(inactive.map((s) => `agent:${s.workspaceId}`))]}
      />
    </div>
  );
}

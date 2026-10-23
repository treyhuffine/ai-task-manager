'use client';


import { FileText, Plus, UserPlus } from 'lucide-react';
import { useTaskCounts } from '@/hooks/use-tasks';
import { TaskSurface } from '@/components/tasks/task-surface';
import { ToolbarToggle, toolbarButtonClass } from '@/components/shared/list-toolbar';
import { Tip } from '@/components/ui/tip';
import { useTeam, useTeamNav } from './team-context';
import { useTeamMembers } from './use-team';
import { MemberAvatar } from './member-avatar';
import { useTeamCreateRecord } from './use-team-create-record';
import { useHomeContext } from '@/components/home/home-context';

/**
 * Contextual task controls around the ordinary shared List and Board:
 * assignees, Team Area filters and membership, without private planning.
 */
export function TeamBoard() {
  const { member } = useTeam();
  const context = useHomeContext();
  const nav = useTeamNav();
  const { byId } = useTeamMembers();
  const create = useTeamCreateRecord();
  const counts = useTaskCounts(null);
  const total = counts.data ? Object.values(counts.data).reduce((sum, n) => sum + (typeof n === 'number' ? n : 0), 0) : null;

  const newTask = create.task;

  return (
    <div className="relative flex h-full flex-col">
      <TaskSurface
        privatePlanning={context.capabilities.privatePlanning}
        viewKey={`ri.tasks.view:${context.home.id}:${context.viewer.id}`}
        initialView="board"
        onOpenTask={nav.openTask}
        assigneeMemberId={nav.mine ? member.id : null}
        createDefaults={create.taskDefaults}
        areaFilter={nav.areaId ?? 'all'}
        onAreaFilterChange={(mode) => nav.filterArea(mode === 'all' ? null : mode)}
        rowMeta={(task) => {
          const assignee = task.assigneeMemberId ? byId.get(task.assigneeMemberId) : null;
          return assignee ? (
            <Tip label={`Assigned to ${assignee.name}`}>
              <span className="ml-auto">
                <MemberAvatar name={assignee.name} size="xs" />
              </span>
            </Tip>
          ) : null;
        }}
        contextControls={
          <>
            <ToolbarToggle active={nav.mine} onClick={() => nav.setMine(!nav.mine)}>
              Assigned to me
            </ToolbarToggle>
          </>
        }
        trailing={
          <button type="button" onClick={() => void newTask()} className={toolbarButtonClass()} aria-label="New task">
            <Plus className="size-3.5" />
            <span className="hidden @sm/lt:inline">New task</span>
          </button>
        }
      />
      {total === 0 && !nav.mine && <EmptyTeam onNewTask={() => void newTask()} />}
    </div>
  );
}

/** A new team: something to do first, and for its owner, someone to do it with. */
function EmptyTeam({ onNewTask }: { onNewTask: () => void }) {
  const homeCapabilities = useHomeContext().capabilities;
  const { team } = useTeam();
  const nav = useTeamNav();
  const create = useTeamCreateRecord();
  const action = 'inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/50';
  return (
    <div className="pointer-events-none absolute inset-x-0 top-24 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-sm">
        <p className="text-sm font-semibold">{team.name} is ready</p>
        <p className="mt-1 text-xs text-muted-foreground">Everyone in the team sees what you add here. Areas are optional.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={action} onClick={onNewTask}>
            <Plus size={13} /> New task
          </button>
          <button
            type="button"
            className={action}
            onClick={() => void create.note()}
          >
            <FileText size={13} /> New note
          </button>
          {homeCapabilities.administerMembers && (
            <button type="button" className={action} onClick={() => nav.openPanel('settings')}>
              <UserPlus size={13} /> Invite people
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

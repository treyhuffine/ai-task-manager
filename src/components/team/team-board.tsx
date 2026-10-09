'use client';

import { FileText, Plus, UserPlus } from 'lucide-react';
import { useCreateNote } from '@/hooks/use-notes';
import { useCreateTask, useTaskCounts } from '@/hooks/use-tasks';
import { TaskKanban } from '@/components/tasks/task-kanban';
import { ToolbarToggle, toolbarButtonClass } from '@/components/shared/list-toolbar';
import { Tip } from '@/components/ui/tip';
import { useTeam, useTeamNav } from './team-context';
import { useTeamMembers } from './use-team';
import { MemberAvatar } from './member-avatar';

/**
 * The team's Task Board (docs/homes-spec.md §3.2): every shared task, with
 * Assigned to me as a filter and the team's Areas as filters. The personal
 * board, without anything about agents: a team runs none.
 */
export function TeamBoard() {
  const { member } = useTeam();
  const nav = useTeamNav();
  const { byId } = useTeamMembers();
  const createTask = useCreateTask();
  const counts = useTaskCounts(null);
  const total = counts.data ? Object.values(counts.data).reduce((sum, n) => sum + (typeof n === 'number' ? n : 0), 0) : null;

  const newTask = async () => {
    const task = await createTask.mutateAsync({
      title: ' ',
      rawInput: ' ',
      ...(nav.mine ? { assigneeMemberId: member.id } : {}),
      ...(nav.areaId ? { areaId: nav.areaId } : {}),
    });
    nav.openTask(task.id);
  };

  return (
    <div className="relative flex h-full flex-col">
      <TaskKanban
        agents={false}
        onOpenTask={nav.openTask}
        assigneeMemberId={nav.mine ? member.id : null}
        createDefaults={nav.mine ? { assigneeMemberId: member.id } : undefined}
        areaFilter={nav.areaId ?? 'all'}
        onAreaFilterChange={(mode) => nav.filterArea(mode === 'all' ? null : mode)}
        cardMeta={(task) => {
          const assignee = task.assigneeMemberId ? byId.get(task.assigneeMemberId) : null;
          return assignee ? (
            <Tip label={`Assigned to ${assignee.name}`}>
              <span className="ml-auto">
                <MemberAvatar name={assignee.name} size="xs" />
              </span>
            </Tip>
          ) : null;
        }}
        leading={
          <>
            <span className="px-1 text-[12px] font-semibold">Task Board</span>
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
  const { team, member } = useTeam();
  const nav = useTeamNav();
  const createNote = useCreateNote();
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
            onClick={async () => {
              const note = await createNote.mutateAsync({ body: '' });
              nav.openNote(note.id);
            }}
          >
            <FileText size={13} /> New note
          </button>
          {member.role === 'owner' && (
            <button type="button" className={action} onClick={() => nav.openPanel('settings')}>
              <UserPlus size={13} /> Invite people
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

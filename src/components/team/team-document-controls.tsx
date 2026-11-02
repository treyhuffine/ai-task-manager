'use client';
import { Users } from 'lucide-react';
import type { EntityVersionRecord, TaskRecord } from '@/db/types';
import { useTeam } from './team-context';
import { useTeamMembers } from './use-team';
import { MemberAvatar } from './member-avatar';
import { useUpdateTask } from '@/hooks/use-tasks';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EntityHistoryButton } from '@/components/chat-ui/edits/entity-history-button';
import { useConfirm } from '@/components/ui/confirm-dialog';

export function TeamAudience() {
  const { team } = useTeam();
  return <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"><Users size={11} className="shrink-0" aria-hidden /><span className="truncate">Shared with {team.name}</span></span>;
}
export function TeamTaskAssignee({ task }: { task: TaskRecord }) {
  const { member } = useTeam();
  const { active } = useTeamMembers();
  const update = useUpdateTask();
  const assignee = active.find(value => value.id === task.assigneeMemberId);
  return <><span className="font-medium text-muted-foreground">Assigned to</span><DropdownMenu>
    <DropdownMenuTrigger className="inline-flex w-fit items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-muted/50" aria-label="Assigned to">
      {assignee && <MemberAvatar name={assignee.name} size="xs" />}<span>{assignee?.name ?? 'Nobody'}</span>
    </DropdownMenuTrigger><DropdownMenuContent align="start" className="w-48"><DropdownMenuRadioGroup value={task.assigneeMemberId ?? ''} onValueChange={value => update.mutate({ id: task.id, assigneeMemberId: value || null })}>
      <DropdownMenuRadioItem value="" className="text-xs">Nobody</DropdownMenuRadioItem>{active.map(value => <DropdownMenuRadioItem key={value.id} value={value.id} className="text-xs">{value.name}{value.id === member.id ? ' (you)' : ''}</DropdownMenuRadioItem>)}
    </DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu></>;
}
function describe(version: EntityVersionRecord, name: (id: string | null) => string) {
  const who = name(version.actorMemberId ?? null);
  const by = version.source !== 'ai' ? who : version.actorSessionId ? `Team AI, for ${who},` : `${who}'s agent`;
  return version.summary === 'Created' ? `${by} added this` : version.revertedFromVersionId ? `${by} restored an earlier version` : `${by} changed this`;
}
export function TeamEntityHistory({ kind, id, bodyRevision }: { kind: 'task' | 'note'; id: string; bodyRevision: number }) {
  const { byId } = useTeamMembers();
  const confirm = useConfirm();
  return <EntityHistoryButton entityType={kind} entityId={id} expectedBodyRevision={bodyRevision}
    describeActor={version => describe(version, memberId => memberId ? byId.get(memberId)?.name ?? 'Former member' : 'Someone')}
    confirmRevert={() => confirm({ title: 'Restore this version?', description: 'Everyone sees the restored text. The change stays in history.', confirmLabel: 'Restore' })} />;
}

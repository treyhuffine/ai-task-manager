'use client';
import type { TaskRecord, UpdateTaskInput } from '@/db/types';
import { ChevronLeft } from 'lucide-react';
import { TaskDocument } from '@/components/tasks/task-document';
import { TaskResults } from '@/components/results/task-results';
import { LinkedReferences } from '@/components/shared/linked-references';
import { TeamPublishedResults } from '@/components/spaces/published-results';
import { TeamTaskAssignee } from './team-document-controls';
import { TeamAreaSelect } from './team-areas';
import { SharedBodyState, type useSharedBody } from './shared-body-editor';

/** Team fields and revision policy inside the ordinary task document. */
export function TeamTaskDocument({ task, parentTask, openTask, save, autosave, shared }: {
  task: TaskRecord; parentTask?: TaskRecord; openTask: (id: string) => void;
  save: (patch: UpdateTaskInput) => void; autosave: (patch: UpdateTaskInput) => void;
  shared: ReturnType<typeof useSharedBody>;
}) {
  if (!shared.ready) return <p role="status" className="p-6 text-sm text-muted-foreground">Loading document…</p>;
  return <TaskDocument task={task} onTitleChange={title => autosave({ title })} onAreaChange={areaId => save({ areaId })} onDeadlineChange={hardDeadline => save({ hardDeadline })}
    areaControl={<TeamAreaSelect value={task.areaId} onChange={areaId => save({ areaId })} />}
    breadcrumb={parentTask && <button onClick={() => openTask(parentTask.id)} className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft size={12} />{parentTask.title}</button>}
    properties={<TeamTaskAssignee task={task} />} notice={<SharedBodyState shared={shared} />}
    bodyKey={shared.editorKey} bodyEditor={{ content: shared.initial, onChange: shared.edit, applyExternalContent: shared.applyExternalContent, onAttachment: shared.onAttachment, hideFooter: true }}
    footer={<><div className="px-4 md:px-12"><TaskResults taskId={task.id} /><TeamPublishedResults taskId={task.id} /></div><div className="px-4 pb-8 md:px-12"><LinkedReferences entityType="task" entityId={task.id} /></div></>} />;
}

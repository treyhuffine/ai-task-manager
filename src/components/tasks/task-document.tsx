'use client';

import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { TaskDateField } from './task-date-field';
import { RichEditor } from '@/components/editor/rich-editor';
import { AreaSelect } from '@/components/shared/area-select';
import { LifecycleStatusControl } from './lifecycle-status-control';
import { useAutosizeTextarea } from '@/hooks/use-autosize-textarea';
import type { TaskRecord } from '@/db/types';
import { cn } from '@/lib/utils';

/** Common task document. Audiences and private planning are contextual slots. */
export function TaskDocument({ task, onTitleChange, onAreaChange, onDeadlineChange, properties, afterProperties, breadcrumb, notice, footer, bodyEditor, bodyKey, areaControl, bodyContent }: {
  task: TaskRecord;
  onTitleChange: (title: string) => void;
  onAreaChange: (id: string | null) => void;
  onDeadlineChange: (date: string | null) => void;
  properties?: ReactNode;
  afterProperties?: ReactNode;
  breadcrumb?: ReactNode;
  notice?: ReactNode;
  footer?: ReactNode;
  bodyEditor?: ComponentProps<typeof RichEditor>;
  bodyContent?: ReactNode;
  bodyKey?: string | number;
  areaControl?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const { ref: attachTitle, resize } = useAutosizeTextarea();
  const empty = !task.title.trim() && !task.body;
  useEffect(() => {
    const element = root.current?.querySelector<HTMLTextAreaElement>('[data-entity-title]');
    if (!element || document.activeElement === element) return;
    if (element.value.trim() !== task.title.trim()) element.value = task.title.trim() ? task.title : '';
    resize();
  }, [task.title, resize]);
  useEffect(() => {
    if (!empty) return;
    const frame = requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[data-entity-title]')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [task.id, empty]);
  return (
    <div ref={root} className="min-w-0 space-y-0">
      <div className="px-4 pt-4 md:px-12">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground/60">{task.parentId ? 'Subtask' : 'Task'}</span>
          <span className="text-muted-foreground/30">·</span>
          {areaControl ?? <AreaSelect value={task.areaId} onChange={onAreaChange} />}
        </div>
        {breadcrumb}
      </div>
      <div className="px-4 pt-1 md:px-12">
        <textarea ref={attachTitle} data-entity-title aria-label="Task title" placeholder="Task title" defaultValue={empty ? '' : task.title} rows={1} disabled={bodyEditor?.editable === false}
          className={cn('w-full resize-none overflow-hidden border-none bg-transparent text-2xl font-bold leading-tight text-foreground outline-none placeholder:text-muted-foreground/40', task.status === 'done' && 'text-muted-foreground line-through')}
          onInput={(event) => { resize(); onTitleChange(event.currentTarget.value.trim() || ' '); }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (event.metaKey || event.ctrlKey) return;
            root.current?.querySelector<HTMLElement>('.rich-editor-body')?.focus();
          }}
        />
        <p className="mt-1 text-[10px] text-muted-foreground/50">Created {new Date(task.createdAt).toLocaleDateString()}{task.updatedAt !== task.createdAt && <> · Edited {new Date(task.updatedAt).toLocaleDateString()}</>}{task.completedAt && <> · Completed {new Date(task.completedAt).toLocaleDateString()}</>}</p>
      </div>
      <div className="px-4 pb-2 pt-4 md:px-12">
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2 border-b border-border pb-4 text-xs">
          <span className="font-medium text-muted-foreground">Status</span>
          <LifecycleStatusControl taskId={task.id} status={task.status} className="-ml-1.5" />
          <span className="font-medium text-muted-foreground">Deadline</span>
          <TaskDateField label="Deadline" value={task.hardDeadline} onChange={onDeadlineChange} highlightOverdue={task.status !== 'done'} />
          {properties}
        </div>
        {notice}
      </div>
      {afterProperties}
      <div className="task-slideout-editor px-4 pb-8 pt-2 md:px-12">{bodyContent ?? (bodyEditor ? <RichEditor key={bodyKey ?? task.id} {...bodyEditor} /> : null)}</div>
      {footer}
    </div>
  );
}

 'use client';
import type { ComponentProps } from 'react';
import type { TaskRecord, UpdateTaskInput } from '@/db/types';
import { ChevronLeft, Repeat, Lock } from 'lucide-react';
import { TaskDocument } from './task-document';
import { TaskPlanningProperties } from './task-planning-properties';
import { SubtaskSection } from './subtask-section';
import { TaskResults } from '@/components/results/task-results';
import { LinkedReferences } from '@/components/shared/linked-references';

/** One personal document composition for sheets and full-page routes. */
export function PersonalTaskDocument({ task, parentTask, openTask, save, autosave, bodyEditor }: {
  task: TaskRecord; parentTask?: TaskRecord; openTask: (id: string) => void;
  save: (patch: UpdateTaskInput) => void; autosave: (patch: UpdateTaskInput) => void;
  bodyEditor: ComponentProps<typeof TaskDocument>['bodyEditor'];
}) {
  const saveField = (field: string, value: unknown) => save({ [field]: value });
  return <TaskDocument task={task}
                      onTitleChange={(title) => autosave({ title })}
                      onAreaChange={(areaId) => saveField('areaId', areaId)}
                      onDeadlineChange={(value) => saveField('hardDeadline', value)}
                      breadcrumb={task.parentId && parentTask ? <button onClick={() => openTask(task.parentId!)} className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft size={12} /><span className="max-w-[300px] truncate">{parentTask.title}</span></button> : null}
                      properties={<>
                        <TaskPlanningProperties task={task} save={save} />

                        {/* Recurrence */}
                        {task.recurrence && (
                          <>
                            <span className="text-muted-foreground font-medium">Recurrence</span>
                            <span className="inline-flex items-center gap-1 text-primary/60 font-medium">
                              <Repeat size={10} /> {task.recurrence}
                            </span>
                          </>
                        )}

                        {/* Blocked */}
                        {task.blockedOn && (
                          <>
                            <span className="text-muted-foreground font-medium">Blocked on</span>
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center gap-1 text-amber-500 font-medium">
                                <Lock size={10} /> {task.blockedOn}
                              </span>
                              <button
                                onClick={() => {
                                  saveField('blockedOn', null);
                                  saveField('blockedSince', null);
                                }}
                                className="text-[10px] text-muted-foreground hover:text-foreground underline"
                              >
                                Unblock
                              </button>
                            </div>
                          </>
                        )}

                      </>}
                      afterProperties={<SubtaskSection parentId={task.id} onOpenTask={openTask} />}
                      bodyEditor={bodyEditor}
                      footer={<>
                    <div className="px-4 md:px-12"><TaskResults key={task.id} taskId={task.id} /></div>
                    <div className="px-4 md:px-12 pb-8">
                      <LinkedReferences entityType="task" entityId={task.id} />
                    </div>
                      </>}
  />;
}

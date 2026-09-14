'use client';

import { SegmentedTabs } from '@/components/shared/list-toolbar';

/** List vs Kanban — two views over the same records, same lifecycle. */
export type TaskView = 'list' | 'board';

/** Persisted across reloads. */
export const TASK_VIEW_KEY = 'ri.tasks.view';

const VIEW_TABS = [
  { value: 'list', label: 'List' },
  { value: 'board', label: 'Board' },
] as const;

/**
 * The List/Board switcher. Rendered at the left of each surface's own toolbar
 * (not a separate strip) so it sits inline with that surface's controls.
 */
export function TaskViewToggle({
  value,
  onChange,
}: {
  value: TaskView;
  onChange: (next: TaskView) => void;
}) {
  return (
    <SegmentedTabs<TaskView>
      ariaLabel="Task view"
      value={value}
      onChange={onChange}
      options={VIEW_TABS}
      grow={false}
    />
  );
}

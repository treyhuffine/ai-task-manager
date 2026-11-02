"use client";

import { teamDisplayName } from '@/lib/home/team-display-name';
import { cn } from '@/lib/utils';
import { entityKeys } from '@/lib/query/entity-keys';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { tasksApi } from '@/lib/api/tasks';
import { bucketRank, type Bucket } from '@/lib/utils/bucket-placement';
import { Target, Filter, ArrowDownAz, Loader2, Plus, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTasks, useUpdateTask, useCreateTask, useTaskCounts, useTaskAttention } from '@/hooks/use-tasks';
import { useTaskLifecycle } from '@/hooks/use-task-lifecycle';
import { TASK_LANES, LANE_BY_KEY, laneStatus, ACTIVE_STATUSES, type TaskLane } from '@/lib/tasks/lanes';
import { useAreas } from '@/hooks/use-areas';
import type { TaskAttentionSignals } from '@/db/types';
import type { ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  ListToolbar,
  ToolbarActiveDot,
  ToolbarSearchButton,
  toolbarButtonClass,
} from '@/components/shared/list-toolbar';
import { TaskViewToggle, type TaskView } from './task-view';
import { TaskRow } from './task-row';
import { todayLocalDate } from '@/lib/deck/date';
import type { Energy } from '@/db/types';
import { useConnectedTeams } from '@/components/spaces/space-selector';
import type { TaskListDTO } from '@/lib/api/dto/entity-list';
import { ImportedWorkNotice } from '@/components/spaces/imported-work-notice';
import { Tip } from '@/components/ui/tip';

import { GROUP_LABELS, groupTaskList, taskGroupKey, placeInTaskGroup, readTaskListPreferences, type TaskListGrouping, type TaskListSort as SortOption } from '@/lib/tasks/list-groups';

// A single lane, the aggregate "Active" working set (non-terminal statuses),
// or "All". 'active' and 'all' are multi-status views, not real lanes.
type LaneFilter = TaskLane | 'all' | 'active';

const SORT_LABELS: Record<SortOption, string> = {
  sortKey: 'Priority Order',
  lastViewedAt: 'Last viewed',
  hardDeadline: 'Deadline',
  createdAt: 'Created',
  updatedAt: 'Updated',
};

export interface TaskListProps {
  onOpenTask: (id: string) => void;
  view?: TaskView;
  onViewChange?: (next: TaskView) => void;
  privatePlanning?: boolean;
  initialLane?: LaneFilter;
  assigneeMemberId?: string | null;
  createDefaults?: Record<string, unknown>;
  contextControls?: ReactNode;
  filterControls?: ReactNode;
  trailing?: ReactNode;
  rowMeta?: (task: TaskListDTO) => ReactNode;
  listPreferenceKey?: string;
  assigneeNames?: ReadonlyMap<string, string>;
  areaFilter?: string;
  onAreaFilterChange?: (value: string) => void;
  onSearch?: () => void;
}

export function TaskList({ view, onViewChange, onOpenTask: openTask, privatePlanning = true, initialLane = 'current', assigneeMemberId, createDefaults, contextControls, filterControls, trailing, rowMeta, listPreferenceKey, assigneeNames, areaFilter: controlledArea, onAreaFilterChange, onSearch }: TaskListProps) {

  const [laneFilter, setLaneFilter] = useState<LaneFilter>(initialLane);
  const [energyFilter, setEnergyFilter] = useState<Energy | 'all'>('all');
  const [ownAreaFilter, setOwnAreaFilter] = useState('all');
  const areaFilter = controlledArea ?? ownAreaFilter;
  const setAreaFilter = onAreaFilterChange ?? setOwnAreaFilter;
  // Where tasks come from (docs/homes-spec.md §9.3): My Ri's own, or a
  // connected team's. Offered once a team is connected.
  const [sourceFilter, setSourceFilter] = useState<'all' | 'personal' | string>('all');
  const { data: teams } = useConnectedTeams(privatePlanning);
  const sourceTeams = privatePlanning ? teams ?? [] : [];
  const source = sourceFilter === 'all' || (sourceFilter !== 'personal' && !sourceTeams.some((t) => t.id === sourceFilter)) ? null : sourceFilter;
  const [preferences, setPreferences] = useState(() => readTaskListPreferences(listPreferenceKey, privatePlanning));
  const { sort: sortBy, group: groupBy } = preferences;
  const setSortBy = (sort: SortOption) => setPreferences(previous => ({ ...previous, sort }));
  useEffect(() => {
    if (!listPreferenceKey) return;
    try { localStorage.setItem(listPreferenceKey, JSON.stringify(preferences)); } catch { /* storage may be unavailable */ }
  }, [listPreferenceKey, preferences]);
  const [switchedFromSort, setSwitchedFromSort] = useState<SortOption | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const dismissSwitchBanner = useCallback(() => {
    setSwitchedFromSort(null);
    setHighlightId(null);
  }, []);

  // Highlight is transient feedback ("here's where it went"), not selection state.
  // Auto-clear so it doesn't read as a stuck/error state.
  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightId(null), 4000);
    return () => clearTimeout(t);
  }, [highlightId]);

  // 'all' → no status filter; 'active' → the non-terminal union; a lane → its
  // single status. The query layer accepts an array and emits an IN clause.
  const statusFilter =
    laneFilter === 'all' ? undefined : laneFilter === 'active' ? ACTIVE_STATUSES : laneStatus(laneFilter);
  const filter = useMemo(() => ({
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(energyFilter !== 'all' ? { energy: energyFilter as Energy } : {}),
    ...(areaFilter !== 'all' ? { areaId: areaFilter } : {}),
    ...(source ? { source } : {}),
    ...(assigneeMemberId ? { assigneeMemberId } : {}),
    orderBy: sortBy,
  }), [statusFilter, energyFilter, areaFilter, source, assigneeMemberId, sortBy]);

  const queryClient = useQueryClient();
  const { data: tasks, isLoading, error } = useTasks(filter);
  const { data: areas } = useAreas();
  const { data: counts } = useTaskCounts(areaFilter !== 'all' ? areaFilter : null, source, assigneeMemberId);
  const updateTask = useUpdateTask();
  const createTask = useCreateTask();
  const lifecycle = useTaskLifecycle();

  // Attention badges only matter for In-progress work, which appears in the
  // Current Work and Active views.
  const attentionIds = (laneFilter === 'current' || laneFilter === 'active' || laneFilter === 'all') ? (tasks ?? []).map((t) => t.id) : [];
  const { data: attention } = useTaskAttention(attentionIds);

  // Quick-create in the lane, defaulting to the lane's semantics: Consider
  // creates a possibility, Todo commits, Current Work creates a Todo then Starts
  // it (so lifecycle history stays valid). Active adds to Todo. Done/Archived/All
  // do not offer creation.
  // A team's tasks are created in its own space, so a team's list offers none.
  const quickCreateLane: TaskLane | null =
    source && source !== 'personal'
      ? null
      : laneFilter === 'active'
      ? 'todo'
      : laneFilter !== 'all' && laneFilter !== 'done' && laneFilter !== 'archived'
        ? (laneFilter as TaskLane)
        : null;
  const handleQuickCreate = useCallback(
    async (title: string) => {
      const trimmed = title.trim();
      if (!trimmed || !quickCreateLane) return;
      const status = quickCreateLane === 'consider' ? 'consider' : 'todo';
      const created = await createTask.mutateAsync({
        ...createDefaults,
        title: trimmed,
        rawInput: trimmed,
        status,
        ...(areaFilter !== 'all' ? { areaId: areaFilter } : {}),
      } as Parameters<typeof createTask.mutateAsync>[0]);
      if (quickCreateLane === 'current' && created?.id) lifecycle.start(created.id);
    },
    [quickCreateLane, createTask, areaFilter, lifecycle, createDefaults],
  );

  const areaLabel =
    areaFilter === 'all'
      ? 'All Areas'
      : areas?.find((a) => a.id === areaFilter)?.name ?? 'All Areas';
  const groups = useMemo(() => groupTaskList(tasks ?? [], groupBy,
    new Map(areas?.map(area => [area.id, area.name])), assigneeNames ?? new Map()), [tasks, groupBy, areas, assigneeNames]);

  // Filter menu holds Source, Area and Energy. The trigger flags when any narrows the list.
  const sourceLabel = source === 'personal' ? 'My Ri' : source ? sourceTeams.find((t) => t.id === source)?.name ?? 'Team' : null;
  const filterActive = areaFilter !== 'all' || energyFilter !== 'all' || !!source || (!privatePlanning && (laneFilter !== 'all' || !!assigneeMemberId));
  const filterSummary =
    sourceLabel
      ? sourceLabel
      : areaFilter !== 'all'
        ? areaLabel
        : energyFilter !== 'all'
          ? energyFilter === 'deep' ? 'Deep' : 'Light'
          : 'Filter';
  // Status is the primary selector; its trigger shows the active lane + count.
  const activeCount = (counts?.consider ?? 0) + (counts?.todo ?? 0) + (counts?.in_progress ?? 0);
  const laneLabel =
    laneFilter === 'all' ? 'All' : laneFilter === 'active' ? 'Active' : LANE_BY_KEY[laneFilter].label;
  const laneCount =
    laneFilter === 'all' ? undefined : laneFilter === 'active' ? activeCount : counts?.[laneStatus(laneFilter)];

  const sensors = useSensors(
    // Mouse: any small drag starts reorder
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // Touch: long-press to reorder so normal taps/scrolls still work on mobile
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleComplete = useCallback((id: string) => {
    const task = tasks?.find(t => t.id === id);
    if (!task) return;
    // Terminal -> reopen/restore, otherwise complete. Routed through the shared
    // lifecycle actions (semantic commands), never a raw status write.
    lifecycle.toggle(id, task.status);
  }, [tasks, lifecycle]);

  const handleUpdate = useCallback((id: string, field: string, value: unknown) => {
    updateTask.mutate({ id, [field]: value } as Parameters<typeof updateTask.mutate>[0]);
  }, [updateTask]);

  const handleSnooze = useCallback((id: string, days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    updateTask.mutate({
      id,
      resurfaceAfter: todayLocalDate(date),
      timesDeferred: undefined, // let the server handle increment ideally, but for now just set resurface
    } as Parameters<typeof updateTask.mutate>[0]);
  }, [updateTask]);

  const handleArchive = useCallback((id: string) => {
    lifecycle.archive(id);
  }, [lifecycle]);

  const handleDragIntercept = useCallback((taskId: string) => {
    if (sortBy === 'sortKey') return;
    setSwitchedFromSort(sortBy);
    setSortBy('sortKey');
    setHighlightId(taskId);
  }, [sortBy]);

  const handleSwitchBack = useCallback(() => {
    if (!switchedFromSort) return;
    setSortBy(switchedFromSort);
    dismissSwitchBanner();
  }, [switchedFromSort, dismissSwitchBanner]);

  const savePlacement = useCallback((placement: ReturnType<typeof placeInTaskGroup>) => {
    if (!placement || !placement.writes.length) return;
    const priorityKey = entityKeys.tasks.list({ ...filter, orderBy: 'sortKey' });
    const previousData = queryClient.getQueryData(priorityKey);
    queryClient.setQueryData(priorityKey, placement.list);
    Promise.all(placement.writes.map(patch => tasksApi.update(patch.id, { sortKey: patch.sortKey })))
      .then(() => queryClient.invalidateQueries({ queryKey: entityKeys.tasks.all }))
      .catch(() => queryClient.setQueryData(priorityKey, previousData));
  }, [filter, queryClient]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !tasks || sortBy !== 'sortKey') return;
    const moved = tasks.find(task => task.id === active.id);
    if (!moved) return;
    const group = tasks.filter(task => taskGroupKey(task, groupBy) === taskGroupKey(moved, groupBy));
    const index = group.findIndex(task => task.id === over.id);
    // List reordering never silently changes status, area or assignment.
    // Board provides explicit cross-status moves.
    if (index < 0) return;
    savePlacement(placeInTaskGroup(tasks, moved.id, index + 1, groupBy));
  }, [tasks, sortBy, groupBy, savePlacement]);

  const handlePickBucket = useCallback((taskId: string, bucket: Bucket) => {
    if (!tasks) return;
    const moved = tasks.find(task => task.id === taskId);
    if (!moved) return;
    const count = tasks.filter(task => taskGroupKey(task, groupBy) === taskGroupKey(moved, groupBy)).length;
    if (sortBy !== 'sortKey') {
      setSwitchedFromSort(sortBy);
      setSortBy('sortKey');
    }
    setHighlightId(taskId);
    savePlacement(placeInTaskGroup(tasks, taskId, bucketRank(bucket, count), groupBy));
  }, [tasks, sortBy, groupBy, savePlacement]);

  const statusOptions = (
    <DropdownMenuRadioGroup
      value={laneFilter}
      onValueChange={(v) => { setLaneFilter(v as LaneFilter); dismissSwitchBanner(); }}
    >
      {/* Combined views — spelled out so they don't read as a status */}
      <DropdownMenuLabel className="text-[9px] uppercase tracking-widest">Views</DropdownMenuLabel>
      <DropdownMenuRadioItem value="all" className="text-xs">
        <span className="flex flex-1 flex-col gap-0.5">
          <span>All</span>
          <span className="text-[10px] font-normal text-muted-foreground">Every status</span>
        </span>
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="active" className="text-xs">
        <span className="flex flex-1 flex-col gap-0.5">
          <span>Active</span>
          <span className="text-[10px] font-normal text-muted-foreground">In progress, Todo, Consider</span>
        </span>
        {activeCount > 0 && <span className="ml-2 tabular-nums text-muted-foreground">{activeCount}</span>}
      </DropdownMenuRadioItem>
      <DropdownMenuSeparator />
      {/* Actual statuses */}
      <DropdownMenuLabel className="text-[9px] uppercase tracking-widest">Status</DropdownMenuLabel>
      {TASK_LANES.map((l) => {
        const c = counts?.[laneStatus(l.key)];
        return (
          <DropdownMenuRadioItem key={l.key} value={l.key} className="text-xs">
            <span className="flex-1">{l.label}</span>
            {c != null && c > 0 && <span className="ml-2 tabular-nums text-muted-foreground">{c}</span>}
          </DropdownMenuRadioItem>
        );
      })}
    </DropdownMenuRadioGroup>
  );
  const sortOptions = (
    <DropdownMenuRadioGroup value={sortBy} onValueChange={(v) => { setSortBy(v as SortOption); dismissSwitchBanner(); }}>
      <DropdownMenuRadioItem value="sortKey" className="text-xs">Priority Order<span className="ml-auto text-[10px] text-muted-foreground">Manual</span></DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="lastViewedAt" className="text-xs">Last viewed<span className="ml-auto text-[10px] text-muted-foreground">Recent first</span></DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="hardDeadline" className="text-xs">Deadline<span className="ml-auto text-[10px] text-muted-foreground">Earliest first</span></DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="createdAt" className="text-xs">Created<span className="ml-auto text-[10px] text-muted-foreground">Newest first</span></DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="updatedAt" className="text-xs">Updated<span className="ml-auto text-[10px] text-muted-foreground">Recent first</span></DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  );
  const teamFilterSummary = [laneFilter !== 'all' ? laneLabel : null, assigneeMemberId ? 'Assigned to me' : null, areaFilter !== 'all' ? areaLabel : null].filter(Boolean).join(', ');

  return (
    <div className="flex flex-col h-full">
      {/* Team actions keep one row. Secondary controls collapse by panel width. */}
      <ListToolbar className={privatePlanning ? undefined : 'gap-1 px-2'}>
        {/* List / Board switcher (desktop surface only; mobile is list-only) */}
        {view && onViewChange && <div className={privatePlanning ? 'contents' : 'shrink-0'}><TaskViewToggle value={view} onChange={onViewChange} /></div>}
        {contextControls}

        {/* Personal keeps its primary status selector. Team filters share one menu. */}
        {privatePlanning && <DropdownMenu>
          <DropdownMenuTrigger aria-label={`Status: ${laneLabel}`} className={toolbarButtonClass({ className: 'font-semibold' })}>
            <span className="max-w-[130px] truncate">{laneLabel}</span>
            {laneCount != null && laneCount > 0 && <span className="tabular-nums opacity-60">{laneCount}</span>}
            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">{statusOptions}</DropdownMenuContent>
        </DropdownMenu>}

        <div className="flex-1" />

        {/* Team filters include status and assignment. Personal retains source and energy. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Tip label="Filter tasks" onlyWhenTextHidden>
              <button type="button" aria-label={filterActive ? `Filter, active: ${privatePlanning ? filterSummary : teamFilterSummary}` : 'Filter tasks'}
                className={toolbarButtonClass({ active: filterActive, className: privatePlanning ? undefined : 'w-8 px-0 @lg/lt:w-auto @lg/lt:px-3' })}>
                <Filter className="size-3.5 shrink-0" />
                <span className={cn('hidden max-w-[120px] truncate', privatePlanning ? '@sm/lt:inline' : '@lg/lt:inline')}>{privatePlanning ? filterSummary : 'Filter'}</span>
                {filterActive && <ToolbarActiveDot />}
              </button>
            </Tip>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {!privatePlanning && <>
              {filterControls}
              {filterControls && <DropdownMenuSeparator />}
              {statusOptions}
              <DropdownMenuSeparator />
            </>}
            {sourceTeams.length > 0 && (
              <>
                <DropdownMenuLabel className="text-[9px] uppercase tracking-widest">Source</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={source ?? 'all'} onValueChange={(v) => { setSourceFilter(v); dismissSwitchBanner(); }}>
                  <DropdownMenuRadioItem value="all" className="text-xs">All sources</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="personal" className="text-xs">My Ri</DropdownMenuRadioItem>
                  {sourceTeams.map((team) => (
                    <DropdownMenuRadioItem key={team.id} value={team.id} className="text-xs">
                      {teamDisplayName(team.id, sourceTeams)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
              </>
            )}
            {privatePlanning && <>
            <DropdownMenuLabel className="text-[9px] uppercase tracking-widest">Energy</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={energyFilter}
              onValueChange={(v) => { setEnergyFilter(v as Energy | 'all'); dismissSwitchBanner(); }}
            >
              <DropdownMenuRadioItem value="all" className="text-xs">All energies</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="deep" className="text-xs">Deep</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="light" className="text-xs">Light</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            </>}
            <DropdownMenuLabel className="text-[9px] uppercase tracking-widest">Area</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={areaFilter} onValueChange={(v) => { setAreaFilter(v); dismissSwitchBanner(); }}>
              <DropdownMenuRadioItem value="all" className="text-xs">All Areas</DropdownMenuRadioItem>
              {areas?.map(area => (
                <DropdownMenuRadioItem key={area.id} value={area.id} className="text-xs">
                  {area.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {privatePlanning ? <DropdownMenu>
          <DropdownMenuTrigger aria-label={`Sort by ${SORT_LABELS[sortBy]}`} className={toolbarButtonClass()}>
            <ArrowDownAz className="size-3.5 shrink-0" />
            <span className="hidden @md/lt:inline">{SORT_LABELS[sortBy]}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="text-[9px] uppercase tracking-widest">Sort by</DropdownMenuLabel>
            {sortOptions}
          </DropdownMenuContent>
        </DropdownMenu> : <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Tip label="Grouping and sorting">
              <button type="button" aria-label="Task view options"
                className={toolbarButtonClass({ className: 'w-8 px-0 @lg/lt:w-auto @lg/lt:px-3' })}>
                <SlidersHorizontal className="size-3.5" />
                <span className="hidden @lg/lt:inline">View</span>
              </button>
            </Tip>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-[9px] uppercase tracking-widest">Group by</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={groupBy} onValueChange={group => setPreferences(previous => ({ ...previous, group: group as TaskListGrouping }))}>
              {Object.entries(GROUP_LABELS).map(([value, label]) => <DropdownMenuRadioItem key={value} value={value} className="text-xs">{label}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[9px] uppercase tracking-widest">Sort by</DropdownMenuLabel>
            {sortOptions}
          </DropdownMenuContent>
        </DropdownMenu>}

        <ToolbarSearchButton
          label="Search tasks"
          onClick={onSearch ?? (() => document.dispatchEvent(new CustomEvent('open-search', { detail: { initialQuery: 'task: ' } })))}
        />
        {trailing}
      </ListToolbar>
      {!privatePlanning && <p className="shrink-0 border-b border-border px-3 py-1.5 text-[10px] text-muted-foreground" aria-live="polite">
        {teamFilterSummary && <>{teamFilterSummary}<span aria-hidden> · </span></>}
        {groupBy === 'none' ? 'No grouping' : `Grouped by ${GROUP_LABELS[groupBy].toLowerCase()}`}<span aria-hidden> · </span>
        {sortBy === 'hardDeadline' ? 'Deadline, earliest first. No deadline last.' : sortBy === 'sortKey' ? 'Manual priority within each group' : `${SORT_LABELS[sortBy]}, ${sortBy === 'createdAt' ? 'newest' : 'recent'} first`}
      </p>}
      {source && source !== 'personal' && <ImportedWorkNotice teamId={source} />}

      {/* Sort-switch banner — sticky above the scroll area, inverted for emphasis */}
      {switchedFromSort && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-primary text-primary-foreground text-[11px] font-medium flex-shrink-0 shadow-sm">
          <span>
            Switched to <span className="font-bold">Priority Order</span> so you can reorder.
          </span>
          <button
            onClick={handleSwitchBack}
            className="px-2.5 py-1 rounded bg-primary-foreground/15 hover:bg-primary-foreground/25 text-primary-foreground text-[10px] font-semibold uppercase tracking-wider transition-colors"
          >
            Back to {SORT_LABELS[switchedFromSort]}
          </button>
        </div>
      )}

      {/* Quick-create in the current lane */}
      {quickCreateLane && (
        <QuickCreateRow
          lane={quickCreateLane}
          onCreate={handleQuickCreate}
        />
      )}

      {/* Task list */}
      <VirtualTaskList
        tasks={tasks}
        groups={groups}
        groupBy={groupBy}
        privatePlanning={privatePlanning}
        rowMeta={rowMeta}
        isLoading={isLoading}
        error={error}
        sensors={sensors}
        onDragEnd={handleDragEnd}
        onComplete={handleComplete}
        onUpdate={handleUpdate}
        onSnooze={handleSnooze}
        onArchive={handleArchive}
        onOpen={openTask}
        dragEnabled={sortBy === 'sortKey'}
        highlightId={highlightId}
        onDragIntercept={handleDragIntercept}
        onPickBucket={handlePickBucket}
        signals={attention}
        emptyText={
          laneFilter === 'active'
            ? 'Nothing active right now.'
            : laneFilter !== 'all'
              ? LANE_BY_KEY[laneFilter as TaskLane]?.empty ?? 'No tasks found.'
              : 'No tasks found.'
        }
      />
    </div>
  );
}

/* ── Quick-create row ── */

function QuickCreateRow({ lane, onCreate }: { lane: TaskLane; onCreate: (title: string) => void }) {
  const [value, setValue] = useState('');
  const placeholder =
    lane === 'consider'
      ? 'Park a possibility in Consider…'
      : lane === 'current'
        ? 'Start a task…'
        : 'Add a task to Todo…';
  const submit = () => {
    if (!value.trim()) return;
    onCreate(value);
    setValue('');
  };
  return (
    <div className="flex items-center gap-2 border-t border-border px-3 py-1.5">
      <Plus size={13} className="text-muted-foreground flex-shrink-0" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') setValue('');
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/50"
      />
    </div>
  );
}

/* ── Virtualized inner list ── */

interface VirtualTaskListProps {
  tasks: TaskListDTO[] | undefined;
  groups: ReturnType<typeof groupTaskList>;
  groupBy: TaskListGrouping;
  isLoading: boolean;
  error: { message: string } | null;
  sensors: ReturnType<typeof useSensors>;
  onDragEnd: (event: DragEndEvent) => void;
  onComplete: (id: string) => void;
  onUpdate: (id: string, field: string, value: unknown) => void;
  onSnooze: (id: string, days: number) => void;
  onArchive: (id: string) => void;
  onOpen: (id: string) => void;
  dragEnabled: boolean;
  highlightId: string | null;
  onDragIntercept: (id: string) => void;
  onPickBucket: (id: string, bucket: Bucket) => void;
  signals?: Record<string, TaskAttentionSignals>;
  emptyText: string;
  privatePlanning: boolean;
  rowMeta?: (task: TaskListDTO) => ReactNode;
}

function VirtualTaskList({
  tasks, groups, groupBy, isLoading, error, sensors, onDragEnd,
  onComplete, onUpdate, onSnooze, onArchive, onOpen,
  dragEnabled, highlightId, onDragIntercept, onPickBucket, signals, emptyText, privatePlanning, rowMeta,
}: VirtualTaskListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  type Row = { kind: 'group'; key: string; label: string; count: number } | { kind: 'task'; key: string; task: TaskListDTO };
  const rows: Row[] = groups.flatMap(group => {
    const header: Row[] = groupBy === 'none' ? [] : [{ kind: 'group', key: `group:${groupBy}:${group.key}`, label: group.label, count: group.tasks.length }];
    return groupBy !== 'none' && collapsed.has(header[0].key) ? header : [...header, ...group.tasks.map(task => ({ kind: 'task' as const, key: task.id, task }))];
  });

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: index => rows[index]?.kind === 'group' ? 36 : 56,
    overscan: 10,
    getItemKey: (index) => rows[index]?.key ?? index,
  });

  // Scroll to + reveal the highlighted task once it's in the new sorted list
  const lastScrolledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!highlightId) {
      lastScrolledRef.current = null;
      return;
    }
    if (!tasks || lastScrolledRef.current === highlightId) return;
    const group = groups.find(group => group.tasks.some(task => task.id === highlightId));
    const key = group && `group:${groupBy}:${group.key}`;
    if (key && collapsed.has(key)) {
      setCollapsed(previous => { const next = new Set(previous); next.delete(key); return next; });
      return;
    }
    const idx = rows.findIndex(row => row.kind === 'task' && row.task.id === highlightId);
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: 'center' });
      lastScrolledRef.current = highlightId;
    }
  }, [highlightId, tasks, groups, groupBy, collapsed, rows, virtualizer]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-2">
      {isLoading && (
        <div className="flex items-center justify-center h-32 text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
        </div>
      )}
      {error && (
        <div className="flex items-center justify-center h-32 text-destructive text-[11px]">
          Failed to load tasks
        </div>
      )}
      {tasks && tasks.length === 0 && (
        <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2 px-6 text-center">
          <Target size={20} className="opacity-30" />
          <p className="text-[11px]">{emptyText}</p>
        </div>
      )}
      {tasks && tasks.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={rows.flatMap(row => row.kind === 'task' ? [row.task.id] : [])} strategy={verticalListSortingStrategy}>
            <div
              style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index];
                const task = row.kind === 'task' ? row.task : null;
                return (
                  <div
                    key={row.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {row.kind === 'group' ? <button type="button"
                      aria-label={`${row.label}, ${row.count} ${row.count === 1 ? 'task' : 'tasks'}`} aria-expanded={!collapsed.has(row.key)}
                      onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next; })}
                      className="flex h-9 w-full items-center gap-2 border-b border-border px-2 text-left text-[11px] font-semibold text-foreground hover:bg-muted/50">
                      <ChevronDown size={13} className={cn('shrink-0 transition-transform', collapsed.has(row.key) && '-rotate-90')} />
                      <span className="truncate">{row.label}</span><span className="tabular-nums font-normal text-muted-foreground">{row.count}</span>
                    </button> : task && <TaskRow
                      task={task}
                      privatePlanning={privatePlanning}
                      contextMeta={rowMeta?.(task)}
                      onComplete={onComplete}
                      onUpdate={onUpdate}
                      onSnooze={onSnooze}
                      onArchive={onArchive}
                      onOpen={onOpen}
                      dragEnabled={dragEnabled}
                      isHighlighted={task.id === highlightId}
                      onDragIntercept={onDragIntercept}
                      onPickBucket={onPickBucket}
                      signals={signals?.[task.id]}
                    />}
                  </div>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useTasks, useCompleteTask } from '@/hooks/use-tasks';
import { useAreas } from '@/hooks/use-areas';
import { DeckConductor } from './deck-conductor';
import { DeckStack } from './deck-stack';
import { DeckMoreOptions } from './deck-more-options';
import { DeckTaskBrowser } from './deck-task-browser';
import { DeckDayBar } from './deck-day-bar';
import { DeckQuickAddCard } from './deck-quick-add';
import { CheckInIntake } from './check-in-intake';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type {
  DeckPlan,
  DeckItem,
  AlternativeItem,
  RoutineItem,
  WorkMode,
} from '@/types/dashboard';
import type { DeckGenerationContext } from '@/lib/ai/deck-generation';
import type { TaskRecord, DeckRecord, DeckItem as DbDeckItem } from '@/db/types';
import { api, ApiError } from '@/lib/api/client';

// ─── Helpers ────────────────────────────────────────────────────

const EFFORT_SHORT: Record<string, string> = {
  trivial: 'XS',
  small: 'S',
  medium: 'M',
  large: 'L',
  epic: 'XL',
};

function taskToDeckItem(
  task: TaskRecord,
  areaMap: Map<string, string>,
  parentMap: Map<string, string>,
): DeckItem {
  return {
    id: task.id,
    title: task.title,
    parentTitle: task.parentId ? parentMap.get(task.parentId) : undefined,
    areaId: task.areaId ?? undefined,
    areaName: task.areaId ? areaMap.get(task.areaId) : undefined,
    rationale: task.description || task.outcome || '',
    energy: task.energy ?? undefined,
    effort: task.effort ? EFFORT_SHORT[task.effort] ?? task.effort : undefined,
    estimatedMinutes: task.estimatedMinutes ?? undefined,
    hardDeadline: task.hardDeadline ?? undefined,
    taskId: task.id,
  };
}

// ─── Mock routines (replaced by real data later) ────────────────

const MOCK_ROUTINES: RoutineItem[] = [
  { id: 'rt1', title: 'Work out', completedCount: 3, targetCount: 4, period: 'this week', streak: 12, taskId: 'task-rt1' },
  { id: 'rt2', title: 'Read', completedCount: 0, targetCount: 1, period: 'today', streak: 8, taskId: 'task-rt2' },
];


// ─── Previous deck preview ──────────────────────────────────────

function PreviousDeckPreview({
  deck,
  tasks,
  areaMap,
  onResume,
}: {
  deck: DeckRecord;
  tasks: TaskRecord[];
  areaMap: Map<string, string>;
  onResume: () => void;
}) {
  const taskById = new Map<string, TaskRecord>();
  tasks.forEach(t => taskById.set(t.id, t));

  const items = (deck.items as DbDeckItem[])
    .map(item => {
      const task = taskById.get(item.taskId);
      if (!task) return null;
      return {
        title: task.title,
        areaName: task.areaId ? areaMap.get(task.areaId) : undefined,
        done: task.status === 'done',
      };
    })
    .filter(Boolean) as { title: string; areaName?: string; done: boolean }[];

  const hasIncomplete = items.some(item => !item.done);

  // Hide if all tasks are completed or no items remain
  if (items.length === 0 || !hasIncomplete) return null;

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-[11px] text-muted-foreground font-medium">Previous deck</p>
        <button
          onClick={onResume}
          className="text-[10px] text-primary hover:text-primary/80 font-medium transition-colors"
        >
          Resume this deck
        </button>
      </div>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2 py-0.5">
            <span className={cn(
              'text-xs truncate flex-1',
              item.done ? 'text-muted-foreground/40 line-through' : 'text-muted-foreground',
            )}>
              {item.title}
            </span>
            {item.areaName && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground/60 shrink-0">
                {item.areaName}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Hydrate a persisted DeckRecord into a client DeckPlan ──────

function hydrateDeckRecord(
  record: DeckRecord,
  tasks: TaskRecord[],
  areaMap: Map<string, string>,
  parentMap: Map<string, string>,
): DeckPlan {
  const taskById = new Map<string, TaskRecord>();
  tasks.forEach(t => taskById.set(t.id, t));

  const items: DeckItem[] = [];
  for (const dbItem of (record.items as DbDeckItem[])) {
    const task = taskById.get(dbItem.taskId);
    if (!task) continue;
    const item = taskToDeckItem(task, areaMap, parentMap);
    item.rationale = dbItem.rationale;
    if (dbItem.continuityContext) item.continuityContext = dbItem.continuityContext;
    if (dbItem.source === 'user') item.manuallyAdded = true;

    const childTasks = tasks.filter(t => t.parentId === task.id);
    if (childTasks.length > 0) {
      item.subtasks = childTasks.map(ct => ({
        id: ct.id,
        title: ct.title,
        effort: ct.effort ? EFFORT_SHORT[ct.effort] ?? ct.effort : undefined,
        completed: ct.status === 'done',
      }));
    }
    items.push(item);
  }

  const alternatives: AlternativeItem[] = [];
  for (const dbAlt of (record.alternatives as { taskId: string; reason: string }[])) {
    const task = taskById.get(dbAlt.taskId);
    if (!task) continue;
    alternatives.push({
      id: task.id,
      title: task.title,
      parentTitle: task.parentId ? parentMap.get(task.parentId) : undefined,
      areaId: task.areaId ?? undefined,
      areaName: task.areaId ? areaMap.get(task.areaId) : undefined,
      energy: task.energy ?? undefined,
      effort: task.effort ? EFFORT_SHORT[task.effort] ?? task.effort : undefined,
      reason: dbAlt.reason,
      taskId: task.id,
    });
  }

  return {
    deckId: record.id,
    framing: record.framing ?? undefined,
    items,
    alternatives,
    radarItems: [],
    generatedAt: record.createdAt,
  };
}

// ─── Persist deck mutations ─────────────────────────────────────

function persistDeck(deckId: string, plan: DeckPlan) {
  const items: DbDeckItem[] = plan.items.map(item => ({
    taskId: item.taskId,
    rationale: item.rationale,
    continuityContext: item.continuityContext ?? null,
    source: item.manuallyAdded ? 'user' as const : 'ai' as const,
  }));

  const alternatives = plan.alternatives.map(alt => ({
    taskId: alt.taskId,
    reason: alt.reason,
  }));

  api.patch(`/deck/${deckId}`, { items, alternatives })
    .catch(err => console.error('Failed to persist deck:', err));
}

// ─── Main container ─────────────────────────────────────────────

type DeckPhase = 'intake' | 'deck';

export function DeckContainer() {
  const { enterFocusMode, activeDeckId, clearActiveDeckId } = useDashboard();

  // ─── Fetch real data ──────────────────────────────────────────

  const { data: tasks } = useTasks({ status: 'active', limit: 50 });
  const { data: areas } = useAreas();
  const completeTask = useCompleteTask();

  const areaMap = useMemo(() => {
    const m = new Map<string, string>();
    areas?.forEach(a => m.set(a.id, a.name));
    return m;
  }, [areas]);

  const parentMap = useMemo(() => {
    const m = new Map<string, string>();
    tasks?.forEach(t => m.set(t.id, t.title));
    return m;
  }, [tasks]);

  // ─── State ──────────────────────────────────────────────────

  const [phase, setPhase] = useState<DeckPhase>('intake');
  const [plan, setPlan] = useState<DeckPlan | null>(null);

  // Filter state
  const [areaFilter, setAreaFilter] = useState<string | null>(null);
  const [workMode, setWorkMode] = useState<WorkMode>(null);
  const [filterDueToday, setFilterDueToday] = useState(false);

  // Deck interaction state
  const [completedItems, setCompletedItems] = useState<DeckItem[]>([]);
  const [routines, setRoutines] = useState<RoutineItem[]>(MOCK_ROUTINES);
  const [moreOptionsCollapsed, setMoreOptionsCollapsed] = useState(true);
  const [taskBrowserOpen, setTaskBrowserOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  // ─── Load latest deck on mount ────────────────────────────────

  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [previousDeck, setPreviousDeck] = useState<DeckRecord | null>(null);
  const [activeDeckRecord, setActiveDeckRecord] = useState<DeckRecord | null>(null);

  useEffect(() => {
    if (!tasks || initialLoadDone) return;

    // Dev helper: add ?forcePreviousDeck=true to URL to test "resume previous deck" flow
    const forceAsPrevious = new URLSearchParams(window.location.search).has('forcePreviousDeck');

    api.get<DeckRecord | null>('/deck')
      .then((record) => {
        if (record) {
          const recordDate = record.createdAt.slice(0, 10);
          const todayStr = new Date().toISOString().slice(0, 10);
          if (recordDate === todayStr && !forceAsPrevious) {
            const hydrated = hydrateDeckRecord(record, tasks, areaMap, parentMap);
            setPlan(hydrated);
            setActiveDeckRecord(record);
            setPhase('deck');
          } else {
            // Stash it so the intake can offer "resume previous deck"
            setPreviousDeck(record);
          }
        }
      })
      .catch(err => console.error('Failed to load latest deck:', err))
      .finally(() => setInitialLoadDone(true));
  }, [tasks, areaMap, parentMap, initialLoadDone]);

  // ─── Load specific deck when navigated from chat ────────────

  useEffect(() => {
    if (!activeDeckId || !tasks) return;

    // If we already have this deck loaded, just clear the trigger
    if (activeDeckRecord?.id === activeDeckId) {
      clearActiveDeckId();
      return;
    }

    api.get<DeckRecord>(`/deck/${activeDeckId}`)
      .then((record) => {
        const hydrated = hydrateDeckRecord(record, tasks, areaMap, parentMap);
        setPlan(hydrated);
        setActiveDeckRecord(record);
        setPhase('deck');
        setInitialLoadDone(true);
      })
      .catch(err => console.error('Failed to load deck:', err))
      .finally(() => clearActiveDeckId());
  }, [activeDeckId, tasks, areaMap, parentMap, activeDeckRecord, clearActiveDeckId]);

  // ─── Filtered items ─────────────────────────────────────────

  const filteredItems = useMemo(() => {
    if (!plan) return [];
    return plan.items.filter(item => {
      if (areaFilter && item.areaId !== areaFilter) return false;
      if (workMode && item.energy !== workMode) return false;
      if (filterDueToday && !(item.hardDeadline && new Date(item.hardDeadline).toDateString() === new Date().toDateString())) return false;
      return true;
    });
  }, [plan, areaFilter, workMode, filterDueToday]);

  const dueTodayCount = useMemo(() => {
    if (!plan) return 0;
    return plan.items.filter(item => item.hardDeadline && new Date(item.hardDeadline).toDateString() === new Date().toDateString()).length;
  }, [plan]);

  const filteredAlternatives = useMemo(() => {
    if (!plan) return [];
    return plan.alternatives.filter(item => {
      if (areaFilter && item.areaId !== areaFilter) return false;
      if (workMode && item.energy !== workMode) return false;
      return true;
    });
  }, [plan, areaFilter, workMode]);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [phase]);

  // ─── Generate deck ──────────────────────────────────────────

  const [generating, setGenerating] = useState(false);

  const generateDeck = useCallback(async (generationContext: DeckGenerationContext = {}) => {
    if (!tasks) return;

    setGenerating(true);

    try {
      const record = await api.post<DeckRecord>('/deck/generate', generationContext);
      const hydrated = hydrateDeckRecord(record, tasks, areaMap, parentMap);
      setPlan(hydrated);
      setActiveDeckRecord(record);
      setPhase('deck');
    } catch (err) {
      if (err instanceof ApiError) {
        console.error('Deck generation failed:', err.body ?? err.message);
      } else {
        console.error('Deck generation error:', err);
      }
      generateDeckFallback();
    } finally {
      setGenerating(false);
    }
  }, [tasks, areaMap, parentMap]);

  // Fallback: simple client-side deck (no AI)
  const generateDeckFallback = useCallback(() => {
    if (!tasks) return;

    const topLevel = tasks.filter(t => !t.parentId);
    const deckTasks = topLevel.slice(0, 7);
    const altTasks = topLevel.slice(7, 12);

    const items: DeckItem[] = deckTasks.map(t => taskToDeckItem(t, areaMap, parentMap));
    const alternatives: AlternativeItem[] = altTasks.map(t => ({
      id: t.id,
      title: t.title,
      parentTitle: t.parentId ? parentMap.get(t.parentId) : undefined,
      areaId: t.areaId ?? undefined,
      areaName: t.areaId ? areaMap.get(t.areaId) : undefined,
      energy: t.energy ?? undefined,
      effort: t.effort ? EFFORT_SHORT[t.effort] ?? t.effort : undefined,
      reason: 'Lower in priority',
      taskId: t.id,
    }));

    setPlan({
      items,
      alternatives,
      radarItems: [],
      generatedAt: new Date().toISOString(),
    });
    setPhase('deck');
  }, [tasks, areaMap, parentMap]);

  // ─── Intake handlers ───────────────────────────────────────

  const handleIntakeSubmit = useCallback((context: string, chips: string[]) => {
    generateDeck({ context: context || undefined, contextTags: chips.length > 0 ? chips : undefined });
  }, [generateDeck]);

  const handleIntakeSkip = useCallback(() => {
    generateDeck();
  }, [generateDeck]);

  const handleResumePrevious = useCallback(() => {
    if (!previousDeck || !tasks) return;
    const hydrated = hydrateDeckRecord(previousDeck, tasks, areaMap, parentMap);
    setPlan(hydrated);
    setActiveDeckRecord(previousDeck);
    setPreviousDeck(null);
    setMoreOptionsCollapsed(true);
    setPhase('deck');
  }, [previousDeck, tasks, areaMap, parentMap]);

  // ─── Deck interaction handlers ──────────────────────────────

  const handleComplete = useCallback((id: string) => {
    if (!plan) return;
    const item = plan.items.find(i => i.id === id);
    if (item) {
      setCompletedItems(prev => [...prev, item]);
      const updated = { ...plan, items: plan.items.filter(i => i.id !== id) };
      setPlan(updated);
      if (plan.deckId) persistDeck(plan.deckId, updated);
      completeTask.mutate({ id: item.taskId });
    }
  }, [plan, completeTask]);

  const handleNotToday = useCallback((id: string) => {
    if (!plan) return;
    const item = plan.items.find(i => i.id === id);
    if (item) {
      const alt: AlternativeItem = {
        id: item.id,
        title: item.title,
        parentTitle: item.parentTitle,
        areaId: item.areaId,
        areaName: item.areaName,
        energy: item.energy,
        effort: item.effort,
        reason: 'Moved from deck',
        taskId: item.taskId,
      };
      const updated = {
        ...plan,
        items: plan.items.filter(i => i.id !== id),
        alternatives: [alt, ...plan.alternatives],
      };
      setPlan(updated);
      if (plan.deckId) persistDeck(plan.deckId, updated);
    }
  }, [plan]);

  const handlePromote = useCallback((id: string, type: 'alternative' | 'radar') => {
    if (!plan) return;
    if (type === 'alternative') {
      const alt = plan.alternatives.find(a => a.id === id);
      if (alt) {
        const newItem: DeckItem = {
          id: alt.id,
          title: alt.title,
          parentTitle: alt.parentTitle,
          areaId: alt.areaId,
          areaName: alt.areaName,
          rationale: alt.reason,
          energy: alt.energy,
          effort: alt.effort,
          taskId: alt.taskId,
        };
        const updated = {
          ...plan,
          items: [...plan.items, newItem],
          alternatives: plan.alternatives.filter(a => a.id !== id),
        };
        setPlan(updated);
        if (plan.deckId) persistDeck(plan.deckId, updated);
      }
    } else {
      const radar = plan.radarItems?.find(r => r.id === id);
      if (radar) {
        const newItem: DeckItem = {
          id: radar.id,
          title: radar.title,
          areaName: radar.areaName,
          rationale: radar.reason,
          taskId: radar.taskId || radar.id,
        };
        setPlan(prev => prev ? {
          ...prev,
          items: [...prev.items, newItem],
          radarItems: prev.radarItems?.filter(r => r.id !== id),
        } : null);
      }
    }
  }, [plan]);

  const handleReorder = useCallback((newItems: DeckItem[]) => {
    setPlan(prev => {
      if (!prev) return null;
      const updated = { ...prev, items: newItems };
      if (prev.deckId) persistDeck(prev.deckId, updated);
      return updated;
    });
  }, []);

  const handleFocus = useCallback((id: string) => {
    if (!plan) return;
    const item = plan.items.find(i => i.id === id);
    if (item) {
      enterFocusMode({
        title: item.parentTitle ? `${item.parentTitle} — ${item.title}` : item.title,
        project: item.areaName ?? item.parentTitle ?? '',
        context: item.continuityContext ?? item.rationale,
        taskId: item.taskId,
      });
    }
  }, [plan, enterFocusMode]);

  const handleSubtaskComplete = useCallback((itemId: string, subtaskId: string) => {
    setPlan(prev => {
      if (!prev) return null;
      return {
        ...prev,
        items: prev.items.map(item =>
          item.id === itemId && item.subtasks
            ? { ...item, subtasks: item.subtasks.map(s => s.id === subtaskId ? { ...s, completed: true } : s) }
            : item
        ),
      };
    });
  }, []);

  const handleSubtaskDefer = useCallback((itemId: string, subtaskId: string) => {
    setPlan(prev => {
      if (!prev) return null;
      return {
        ...prev,
        items: prev.items.map(item =>
          item.id === itemId && item.subtasks
            ? { ...item, subtasks: item.subtasks.filter(s => s.id !== subtaskId) }
            : item
        ),
      };
    });
  }, []);

  const handleSubtaskFocus = useCallback((itemId: string, subtaskId: string) => {
    if (!plan) return;
    const item = plan.items.find(i => i.id === itemId);
    const subtask = item?.subtasks?.find(s => s.id === subtaskId);
    if (item && subtask) {
      enterFocusMode({
        title: subtask.title,
        project: item.parentTitle ? `${item.parentTitle} — ${item.title}` : item.title,
        context: item.rationale,
        taskId: item.taskId,
      });
    }
  }, [plan, enterFocusMode]);

  const handleRoutineComplete = useCallback((id: string) => {
    setRoutines(prev => prev.map(r =>
      r.id === id ? { ...r, completedCount: r.completedCount + 1 } : r
    ));
  }, []);

  // ─── Re-plan (restart flow) ─────────────────────────────────

  const handleReplan = useCallback(() => {
    if (activeDeckRecord) {
      setPreviousDeck(activeDeckRecord);
      setActiveDeckRecord(null);
    }
    setPlan(null);
    setCompletedItems([]);
    setAreaFilter(null);
    setWorkMode(null);
    setFilterDueToday(false);
    setMoreOptionsCollapsed(false);
    setTaskBrowserOpen(false);
    setPhase('intake');
  }, [activeDeckRecord]);

  const handleViewAllTasks = useCallback(() => {
    setTaskBrowserOpen(true);
    setMoreOptionsCollapsed(true);
  }, []);

  const handleAddFromBrowser = useCallback((task: TaskRecord) => {
    const item = taskToDeckItem(task, areaMap, parentMap);
    item.manuallyAdded = true;
    setPlan(prev => {
      if (!prev) return null;
      const updated = { ...prev, items: [...prev.items, item] };
      if (prev.deckId) persistDeck(prev.deckId, updated);
      return updated;
    });
  }, [areaMap, parentMap]);

  const handleRemoveFromBrowser = useCallback((taskId: string) => {
    setPlan(prev => {
      if (!prev) return null;
      const updated = { ...prev, items: prev.items.filter(i => i.taskId !== taskId) };
      if (prev.deckId) persistDeck(prev.deckId, updated);
      return updated;
    });
  }, []);

  const handleQuickAdd = useCallback((task: TaskRecord) => {
    const item = taskToDeckItem(task, areaMap, parentMap);
    item.manuallyAdded = true;
    item.rationale = '';
    setPlan(prev => {
      if (!prev) return null;
      const updated = { ...prev, items: [...prev.items, item] };
      if (prev.deckId) persistDeck(prev.deckId, updated);
      return updated;
    });
  }, [areaMap, parentMap]);

  const deckTaskIds = useMemo(() => {
    if (!plan) return new Set<string>();
    return new Set(plan.items.map(i => i.taskId));
  }, [plan]);

  // ─── Render ─────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Conductor + day bar — visible when deck is active */}
      {phase === 'deck' && plan && (
        <>
          <DeckConductor
            areaFilter={areaFilter}
            onAreaFilterChange={setAreaFilter}
            workMode={workMode}
            onWorkModeChange={setWorkMode}
            filterDueToday={filterDueToday}
            dueTodayCount={dueTodayCount}
            onFilterDueTodayChange={setFilterDueToday}
            onReplan={handleReplan}
            generatedAt={plan.generatedAt}
          />
          <DeckDayBar
            completedItems={completedItems}
            routines={routines}
            onRoutineComplete={handleRoutineComplete}
            quickAddOpen={quickAddOpen}
            onToggleQuickAdd={() => setQuickAddOpen(o => !o)}
          />
        </>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        {/* ─── Loading: fetching latest deck ─── */}
        {phase === 'intake' && !initialLoadDone && (
          <div className="px-4 py-3">
            {/* Framing line */}
            <Skeleton className="h-3 w-3/4 mb-3" />
            {/* Deck item skeletons — matches flat layout: pl-6 title, pills, rationale */}
            {[0.6, 0.5, 0.7, 0.55, 0.45].map((w, i) => (
              <div key={i} className="pl-6 py-2 space-y-2">
                <Skeleton className="h-3.5" style={{ width: `${w * 100}%` }} />
                <div className="flex gap-1.5">
                  <Skeleton className="h-4 w-14 rounded-md" />
                  <Skeleton className="h-4 w-8 rounded-md" />
                </div>
                <Skeleton className="h-2.5 w-4/5" />
              </div>
            ))}
          </div>
        )}

        {/* ─── Intake: optional context before generation ─── */}
        {phase === 'intake' && initialLoadDone && !generating && (
          <>
            <CheckInIntake
              onSubmit={handleIntakeSubmit}
              onSkip={handleIntakeSkip}
              hasPreviousDeck={!!previousDeck && (previousDeck.items as DbDeckItem[]).some(item => {
                const task = tasks?.find(t => t.id === item.taskId);
                return task && task.status !== 'done';
              })}
              collapsed={false}
              onExpand={() => {}}
            />

            {/* Previous deck preview */}
            {previousDeck && tasks && (
              <PreviousDeckPreview
                deck={previousDeck}
                tasks={tasks}
                areaMap={areaMap}
                onResume={handleResumePrevious}
              />
            )}
          </>
        )}

        {/* ─── Generating state ─── */}
        {generating && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <p className="text-[11px]">Building your deck...</p>
          </div>
        )}

        {/* ─── The deck ─── */}
        {phase === 'deck' && plan && (
          <div className="px-4 py-3">
            {plan.framing && (
              <p className="text-xs text-muted-foreground italic mb-3 leading-relaxed">
                {plan.framing}
              </p>
            )}
            <DeckStack
              items={filteredItems}
              onComplete={handleComplete}
              onNotToday={handleNotToday}
              onFocus={handleFocus}
              onReorder={handleReorder}
              onSubtaskComplete={handleSubtaskComplete}
              onSubtaskDefer={handleSubtaskDefer}
              onSubtaskFocus={handleSubtaskFocus}
            />
            {quickAddOpen && (
              <DeckQuickAddCard
                onTaskCreated={handleQuickAdd}
                onClose={() => setQuickAddOpen(false)}
              />
            )}
          </div>
        )}
      </div>

      {/* Bottom section — pinned */}
      {phase === 'deck' && plan && (
        taskBrowserOpen ? (
          <DeckTaskBrowser
            deckTaskIds={deckTaskIds}
            onAddToDeck={handleAddFromBrowser}
            onRemoveFromDeck={handleRemoveFromBrowser}
            onClose={() => setTaskBrowserOpen(false)}
          />
        ) : (
          <DeckMoreOptions
            alternatives={filteredAlternatives}
            radarItems={plan.radarItems}
            onPromote={handlePromote}
            onViewAllTasks={handleViewAllTasks}
            collapsed={moreOptionsCollapsed}
            onToggleCollapse={() => setMoreOptionsCollapsed(c => !c)}
          />
        )
      )}
    </div>
  );
}

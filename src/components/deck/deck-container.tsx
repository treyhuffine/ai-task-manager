"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useTasks } from '@/hooks/use-tasks';
import { useAreas } from '@/hooks/use-areas';
import { DeckConductor } from './deck-conductor';
import { DeckStack } from './deck-stack';
import { DeckMoreOptions } from './deck-more-options';
import { DeckTaskBrowser } from './deck-task-browser';
import { DeckDayBar } from './deck-day-bar';
import { DeckQuickAddCard } from './deck-quick-add';
import { CheckInIntake } from './check-in-intake';
import type {
  DeckPlan,
  DeckItem,
  AlternativeItem,
  RoutineItem,
  WorkMode,
} from '@/types/dashboard';
import type { DeckGenerationContext, DeckResponse } from '@/lib/ai/deck-generation';
import type { TaskRecord } from '@/db/types';

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
    parentTitle: task.parent_id ? parentMap.get(task.parent_id) : undefined,
    areaId: task.area_id ?? undefined,
    areaName: task.area_id ? areaMap.get(task.area_id) : undefined,
    rationale: task.description || task.outcome || '',
    energy: task.energy ?? undefined,
    effort: task.effort ? EFFORT_SHORT[task.effort] ?? task.effort : undefined,
    estimatedMinutes: task.estimated_minutes ?? undefined,
    hardDeadline: task.hard_deadline ?? undefined,
    taskId: task.id,
  };
}

// ─── Mock routines (replaced by real data later) ────────────────

const MOCK_ROUTINES: RoutineItem[] = [
  { id: 'rt1', title: 'Work out', completedCount: 3, targetCount: 4, period: 'this week', streak: 12, taskId: 'task-rt1' },
  { id: 'rt2', title: 'Read', completedCount: 0, targetCount: 1, period: 'today', streak: 8, taskId: 'task-rt2' },
];


// ─── Main container ─────────────────────────────────────────────

type DeckPhase = 'intake' | 'deck';

export function DeckContainer() {
  const { enterFocusMode } = useDashboard();

  // ─── Fetch real data ──────────────────────────────────────────

  const { data: tasks } = useTasks({ status: 'active', limit: 50 });
  const { data: areas } = useAreas();

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
      const res = await fetch('/api/deck/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(generationContext),
      });

      if (!res.ok) {
        const err = await res.json();
        console.error('Deck generation failed:', err);
        // Fallback to client-side generation
        generateDeckFallback();
        return;
      }

      const aiResponse: DeckResponse = await res.json();

      // Build a lookup of all tasks (including subtasks) for hydration
      const taskById = new Map<string, TaskRecord>();
      tasks.forEach(t => taskById.set(t.id, t));

      // Hydrate AI response into full DeckItems
      const items: DeckItem[] = [];
      for (const ai of aiResponse.items) {
        const task = taskById.get(ai.taskId);
        if (!task) continue;
        const item = taskToDeckItem(task, areaMap, parentMap);
        item.rationale = ai.rationale;
        if (ai.continuityContext) item.continuityContext = ai.continuityContext;

        // Attach subtasks
        const childTasks = tasks.filter(t => t.parent_id === task.id);
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
      for (const ai of aiResponse.alternatives) {
        const task = taskById.get(ai.taskId);
        if (!task) continue;
        alternatives.push({
          id: task.id,
          title: task.title,
          parentTitle: task.parent_id ? parentMap.get(task.parent_id) : undefined,
          areaId: task.area_id ?? undefined,
          areaName: task.area_id ? areaMap.get(task.area_id) : undefined,
          energy: task.energy ?? undefined,
          effort: task.effort ? EFFORT_SHORT[task.effort] ?? task.effort : undefined,
          reason: ai.reason,
          taskId: task.id,
        });
      }

      setPlan({
        dayContext: aiResponse.dayContext ?? undefined,
        items,
        alternatives,
        radarItems: [],
        generatedAt: new Date().toISOString(),
      });
      setPhase('deck');
    } catch (err) {
      console.error('Deck generation error:', err);
      generateDeckFallback();
    } finally {
      setGenerating(false);
    }
  }, [tasks, areaMap, parentMap]);

  // Fallback: simple client-side deck (no AI)
  const generateDeckFallback = useCallback(() => {
    if (!tasks) return;

    const topLevel = tasks.filter(t => !t.parent_id);
    const deckTasks = topLevel.slice(0, 7);
    const altTasks = topLevel.slice(7, 12);

    const items: DeckItem[] = deckTasks.map(t => taskToDeckItem(t, areaMap, parentMap));
    const alternatives: AlternativeItem[] = altTasks.map(t => ({
      id: t.id,
      title: t.title,
      parentTitle: t.parent_id ? parentMap.get(t.parent_id) : undefined,
      areaId: t.area_id ?? undefined,
      areaName: t.area_id ? areaMap.get(t.area_id) : undefined,
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

  // ─── Deck interaction handlers ──────────────────────────────

  const handleComplete = useCallback((id: string) => {
    if (!plan) return;
    const item = plan.items.find(i => i.id === id);
    if (item) {
      setCompletedItems(prev => [...prev, item]);
      setPlan(prev => prev ? { ...prev, items: prev.items.filter(i => i.id !== id) } : null);
    }
  }, [plan]);

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
      setPlan(prev => prev ? {
        ...prev,
        items: prev.items.filter(i => i.id !== id),
        alternatives: [alt, ...prev.alternatives],
      } : null);
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
        setPlan(prev => prev ? {
          ...prev,
          items: [...prev.items, newItem],
          alternatives: prev.alternatives.filter(a => a.id !== id),
        } : null);
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
    setPlan(prev => prev ? { ...prev, items: newItems } : null);
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
    setPlan(null);
    setCompletedItems([]);
    setAreaFilter(null);
    setWorkMode(null);
    setFilterDueToday(false);
    setMoreOptionsCollapsed(false);
    setTaskBrowserOpen(false);
    setPhase('intake');
  }, []);

  const handleViewAllTasks = useCallback(() => {
    setTaskBrowserOpen(true);
    setMoreOptionsCollapsed(true);
  }, []);

  const handleAddFromBrowser = useCallback((task: TaskRecord) => {
    const item = taskToDeckItem(task, areaMap, parentMap);
    setPlan(prev => prev ? { ...prev, items: [...prev.items, item] } : null);
  }, [areaMap, parentMap]);

  const handleRemoveFromBrowser = useCallback((taskId: string) => {
    setPlan(prev => prev ? { ...prev, items: prev.items.filter(i => i.taskId !== taskId) } : null);
  }, []);

  const handleQuickAdd = useCallback((task: TaskRecord) => {
    const item = taskToDeckItem(task, areaMap, parentMap);
    item.manuallyAdded = true;
    item.rationale = '';
    setPlan(prev => prev ? { ...prev, items: [...prev.items, item] } : null);
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

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {/* ─── Intake: optional context before generation ─── */}
        {phase === 'intake' && !generating && (
          <CheckInIntake
            onSubmit={handleIntakeSubmit}
            onSkip={handleIntakeSkip}
            collapsed={false}
            onExpand={() => {}}
          />
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
            {plan.dayContext && (
              <p className="text-xs text-muted-foreground italic mb-3 leading-relaxed">
                {plan.dayContext}
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

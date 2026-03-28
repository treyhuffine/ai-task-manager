"use client";

import { useState, useCallback } from 'react';
import {
  GripVertical, X, Sparkles, Plus, ChevronDown,
  Flame, Zap, Clock, Timer, Check, Play,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DeckPlan, DeepWorkItem, LightTaskItem, AlternativeItem, RoutineItem } from '@/types/dashboard';

// ─── Constants ──────────────────────────────────────────────

const EFFORT_LABELS: Record<string, string> = {
  trivial: 'XS', small: 'S', medium: 'M', large: 'L', epic: 'XL',
};

function formatDeadline(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const diff = d.getTime() - Date.now();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 0 && days <= 7) return `In ${days}d`;
  if (days < 0) return `${Math.abs(days)}d overdue`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Props ──────────────────────────────────────────────────

interface PlanReviewV2Props {
  plan: DeckPlan;
  onConfirm: (plan: DeckPlan) => void;
  onRemoveDeepWork: (id: string) => void;
  onRemoveLightTask: (id: string) => void;
}

// ─── Main component ─────────────────────────────────────────

export function PlanReviewV2({ plan, onConfirm, onRemoveDeepWork, onRemoveLightTask }: PlanReviewV2Props) {
  const [deepWork, setDeepWork] = useState<DeepWorkItem[]>(plan.deepWork ?? []);
  const [lightTasks, setLightTasks] = useState<LightTaskItem[]>(plan.lightTasks ?? []);
  const [alternatives, setAlternatives] = useState<AlternativeItem[]>(plan.alternatives ?? []);
  const [altOpen, setAltOpen] = useState(false);
  const [draggedDeep, setDraggedDeep] = useState<number | null>(null);

  const removeDeep = useCallback((id: string) => {
    const item = deepWork.find(d => d.id === id);
    setDeepWork(prev => prev.filter(d => d.id !== id));
    onRemoveDeepWork(id);
    // Move to alternatives
    if (item) {
      setAlternatives(prev => [...prev, {
        id: item.id,
        title: `${item.projectTitle} — ${item.taskTitle}`,
        areaName: item.areaName,
        energy: item.energy,
        effort: item.effort,
        reason: 'Removed from today\'s plan',
        taskId: item.taskId,
      }]);
    }
  }, [deepWork, onRemoveDeepWork]);

  const removeLight = useCallback((id: string) => {
    const item = lightTasks.find(l => l.id === id);
    setLightTasks(prev => prev.filter(l => l.id !== id));
    onRemoveLightTask(id);
    if (item) {
      setAlternatives(prev => [...prev, {
        id: item.id,
        title: item.title,
        areaName: item.areaName,
        energy: item.energy,
        effort: item.effort,
        reason: 'Removed from today\'s plan',
        taskId: item.taskId,
      }]);
    }
  }, [lightTasks, onRemoveLightTask]);

  const addAlternative = useCallback((alt: AlternativeItem) => {
    setAlternatives(prev => prev.filter(a => a.id !== alt.id));
    if (alt.energy === 'deep') {
      setDeepWork(prev => [...prev, {
        id: alt.id,
        projectTitle: alt.title.split(' — ')[0] || alt.title,
        taskTitle: alt.title.split(' — ')[1] || alt.title,
        areaName: alt.areaName,
        continuityContext: '',
        rationale: '',
        energy: 'deep',
        effort: alt.effort,
        taskId: alt.taskId,
      }]);
    } else {
      setLightTasks(prev => [...prev, {
        id: alt.id,
        title: alt.title,
        areaName: alt.areaName,
        energy: 'light',
        effort: alt.effort,
        isNew: false,
        taskId: alt.taskId,
      }]);
    }
  }, []);

  const handleDeepDragStart = useCallback((idx: number) => setDraggedDeep(idx), []);
  const handleDeepDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (draggedDeep === null || draggedDeep === idx) return;
    setDeepWork(prev => {
      const next = [...prev];
      const [moved] = next.splice(draggedDeep, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    setDraggedDeep(idx);
  }, [draggedDeep]);
  const handleDeepDragEnd = useCallback(() => setDraggedDeep(null), []);

  const handleConfirm = useCallback(() => {
    onConfirm({ ...plan, deepWork, lightTasks });
  }, [plan, deepWork, lightTasks, onConfirm]);

  return (
    <div className="px-4 pt-4 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div>
          <p className="text-[12px] text-foreground font-medium">Your plan for today</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Adjust each section, swap tasks in from alternatives.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
          <Sparkles size={10} className="text-primary/50" />
          {deepWork.length + lightTasks.length} of {plan.meta?.workingSetSize ?? 0}
        </div>
      </div>

      {/* AI summary */}
      {plan.summary && (
        <p className="text-[11px] text-foreground/80 leading-relaxed mb-4 mt-2">
          {plan.summary}
        </p>
      )}

      {/* ─── Deep Work Section ─── */}
      <SectionHeader label="Deep Work" count={deepWork.length} />
      <div className="mb-4 space-y-1.5">
        {deepWork.map((item, idx) => (
          <DeepCard
            key={item.id}
            item={item}
            index={idx}
            isDragging={draggedDeep === idx}
            onDragStart={() => handleDeepDragStart(idx)}
            onDragOver={(e) => handleDeepDragOver(e, idx)}
            onDragEnd={handleDeepDragEnd}
            onRemove={() => removeDeep(item.id)}
          />
        ))}
        {deepWork.length === 0 && (
          <p className="text-[10px] text-muted-foreground py-2 text-center">No deep work — add from alternatives below</p>
        )}
      </div>

      {/* ─── Light Tasks Section ─── */}
      <SectionHeader label="Light / Gaps" count={lightTasks.length} />
      <div className="mb-4 space-y-0.5">
        {lightTasks.map((item) => (
          <LightRow key={item.id} item={item} onRemove={() => removeLight(item.id)} />
        ))}
        {lightTasks.length === 0 && (
          <p className="text-[10px] text-muted-foreground py-2 text-center">No light tasks</p>
        )}
      </div>

      {/* ─── Routines Section ─── */}
      {(plan.routines ?? []).length > 0 && (
        <>
          <SectionHeader label="Routines" count={(plan.routines ?? []).length} />
          <div className="mb-4 space-y-0.5">
            {(plan.routines ?? []).map((item: RoutineItem) => (
              <div key={item.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-card transition-all">
                <div className="flex items-center gap-2.5">
                  <div className="w-4 h-4 rounded border border-border flex items-center justify-center text-transparent">
                    <Check size={10} />
                  </div>
                  <span className="text-[12px] text-foreground/80">{item.title}</span>
                </div>
                <span className="text-[9px] text-muted-foreground">
                  {item.completedCount}/{item.targetCount} {item.period}
                  {item.streak != null && item.streak > 0 && (
                    <span className="ml-2 text-primary/60">{item.streak}d streak</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ─── Also Considered ─── */}
      {alternatives.length > 0 && (
        <div className="mb-4">
          <button
            onClick={() => setAltOpen(!altOpen)}
            className="flex items-center gap-2 w-full mb-2"
          >
            <div className="h-px flex-1 bg-border" />
            <span className="text-[8.5px] font-bold text-muted-foreground uppercase tracking-[0.15em] flex items-center gap-1">
              Also Considered ({alternatives.length})
              <ChevronDown size={10} className={cn('transition-transform', altOpen && 'rotate-180')} />
            </span>
            <div className="h-px flex-1 bg-border" />
          </button>
          {altOpen && (
            <div className="space-y-1">
              {alternatives.map((alt) => (
                <div
                  key={alt.id}
                  className="flex items-center justify-between px-3 py-2 rounded-lg border border-dashed border-border hover:border-primary/30 hover:bg-card transition-all"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-foreground/70 leading-tight">{alt.title}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {alt.areaName && (
                        <span className="text-[8.5px] font-bold text-muted-foreground uppercase tracking-wider">{alt.areaName}</span>
                      )}
                      <span className="text-[9px] text-muted-foreground/60 italic">{alt.reason}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => addAlternative(alt)}
                    className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold text-primary hover:bg-primary/10 rounded-md transition-colors flex-shrink-0 ml-2"
                  >
                    <Plus size={10} /> Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <p className="text-[9px] text-muted-foreground">
          {deepWork.length + lightTasks.length} task{deepWork.length + lightTasks.length !== 1 ? 's' : ''} for today
        </p>
        <button
          onClick={handleConfirm}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-[11px] font-bold rounded-lg hover:opacity-90 active:scale-95 transition-all"
        >
          <Play size={11} /> Start Executing
        </button>
      </div>
    </div>
  );
}

// ─── Section header ─────────────────────────────────────────

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[8.5px] font-bold text-muted-foreground uppercase tracking-[0.15em]">
        {label} ({count})
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

// ─── Deep work card ─────────────────────────────────────────

function DeepCard({
  item,
  index,
  isDragging,
  onDragStart,
  onDragOver,
  onDragEnd,
  onRemove,
}: {
  item: DeepWorkItem;
  index: number;
  isDragging: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onRemove: () => void;
}) {
  const deadline = formatDeadline(item.hardDeadline);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className={cn(
        'rounded-xl bg-card border transition-all group',
        isDragging ? 'border-primary/30 opacity-70' : 'border-border',
      )}
    >
      <div className="flex items-start gap-2.5 px-3 py-3 cursor-grab active:cursor-grabbing">
        <button className="mt-1 p-0.5 text-muted-foreground/40 hover:text-muted-foreground" tabIndex={-1}>
          <GripVertical size={12} />
        </button>
        <span className="text-[10px] font-mono text-muted-foreground w-4 text-right mt-0.5 flex-shrink-0">
          {index + 1}
        </span>
        <div className={cn(
          'w-2 h-2 rounded-full mt-1.5 flex-shrink-0',
          index === 0 ? 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.3)]' : 'bg-primary/60'
        )} />
        <div className="flex-1 min-w-0">
          <h3 className="text-[12px] font-medium text-foreground leading-tight">
            {item.projectTitle} — {item.taskTitle}
          </h3>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            {item.areaName && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[8.5px] font-bold text-muted-foreground uppercase tracking-wider bg-muted/50">
                {item.areaName}
              </span>
            )}
            <span className="inline-flex items-center gap-0.5 text-[8.5px] font-bold text-orange-500 uppercase tracking-wider">
              <Flame size={8} /> deep
            </span>
            {item.effort && (
              <span className="text-[8.5px] font-bold text-muted-foreground uppercase tracking-wider">
                {EFFORT_LABELS[item.effort] ?? item.effort}
              </span>
            )}
            {deadline && (
              <span className={cn(
                'inline-flex items-center gap-0.5 text-[8.5px] font-bold uppercase tracking-wider',
                item.hardDeadline && new Date(item.hardDeadline) < new Date() ? 'text-destructive' : 'text-amber-500',
              )}>
                <Timer size={8} /> {deadline}
              </span>
            )}
          </div>
          {/* Rationale always visible */}
          {item.rationale && (
            <p className="text-[10px] text-muted-foreground leading-relaxed mt-1.5">
              {item.rationale}
            </p>
          )}
          {/* Continuity context */}
          {item.continuityContext && (
            <p className="text-[10px] text-foreground/50 leading-relaxed mt-1 italic">
              {item.continuityContext}
            </p>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
          title="Not today"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

// ─── Light task row ─────────────────────────────────────────

function LightRow({ item, onRemove }: { item: LightTaskItem; onRemove: () => void }) {
  return (
    <div className="group flex items-center justify-between px-3 py-2 rounded-lg hover:bg-card transition-all border border-transparent hover:border-border">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-1.5 h-1.5 rounded-full bg-sky-400/60 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-[12px] font-medium leading-tight truncate text-foreground">{item.title}</p>
          {item.areaName && (
            <span className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider">{item.areaName}</span>
          )}
        </div>
        {item.isNew && (
          <span className="text-[8px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded flex-shrink-0">new</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {item.estimatedMinutes && (
          <span className="text-[9.5px] text-muted-foreground flex items-center gap-0.5">
            <Clock size={8} /> ~{item.estimatedMinutes}m
          </span>
        )}
        <button
          onClick={onRemove}
          className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
          title="Not today"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

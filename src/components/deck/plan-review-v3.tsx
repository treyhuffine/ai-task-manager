"use client";

import { useState, useCallback, useMemo } from 'react';
import {
  X, Sparkles, Plus, ChevronDown, ChevronRight, AlertCircle,
  Flame, Zap, Clock, Timer, Check, Play, GripVertical,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  DeckPlan, DeepWorkItem, LightTaskItem, AlternativeItem, SubtaskItem,
} from '@/types/dashboard';

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

interface PlanReviewV3Props {
  plan: DeckPlan;
  onConfirm: (plan: DeckPlan) => void;
  onRemoveDeepWork: (id: string) => void;
  onRemoveLightTask: (id: string) => void;
}

// ─── Main component ─────────────────────────────────────────

export function PlanReviewV3({ plan, onConfirm, onRemoveDeepWork, onRemoveLightTask }: PlanReviewV3Props) {
  const [deepWork, setDeepWork] = useState<DeepWorkItem[]>(plan.deepWork ?? []);
  const [lightTasks, setLightTasks] = useState<LightTaskItem[]>(plan.lightTasks ?? []);
  const [alternatives, setAlternatives] = useState<AlternativeItem[]>(plan.alternatives ?? []);
  const [altOpen, setAltOpen] = useState(false);
  const [draggedDeep, setDraggedDeep] = useState<number | null>(null);

  const totalTasks = deepWork.length + lightTasks.length;
  const deepAlts = useMemo(() => alternatives.filter(a => a.energy === 'deep'), [alternatives]);
  const lightAlts = useMemo(() => alternatives.filter(a => a.energy === 'light'), [alternatives]);

  // ─── Deep work handlers ─────────────────────────────────

  const removeDeep = useCallback((id: string) => {
    const item = deepWork.find(d => d.id === id);
    setDeepWork(prev => prev.filter(d => d.id !== id));
    onRemoveDeepWork(id);
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

  // ─── Light task handlers ────────────────────────────────

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

  // ─── Add from alternatives ──────────────────────────────

  const addDeepAlt = useCallback((alt: AlternativeItem) => {
    setAlternatives(prev => prev.filter(a => a.id !== alt.id));
    setDeepWork(prev => [...prev, {
      id: alt.id,
      projectTitle: alt.title.split(' — ')[0] || alt.title,
      taskTitle: alt.title.split(' — ')[1] || alt.title,
      areaName: alt.areaName,
      continuityContext: '',
      rationale: alt.reason,
      energy: 'deep',
      effort: alt.effort,
      taskId: alt.taskId,
    }]);
  }, []);

  const addLightAlt = useCallback((alt: AlternativeItem) => {
    setAlternatives(prev => prev.filter(a => a.id !== alt.id));
    setLightTasks(prev => [...prev, {
      id: alt.id,
      title: alt.title,
      areaName: alt.areaName,
      energy: 'light',
      effort: alt.effort,
      isNew: false,
      taskId: alt.taskId,
    }]);
  }, []);

  // ─── Confirm ────────────────────────────────────────────

  const handleConfirm = useCallback(() => {
    onConfirm({ ...plan, deepWork, lightTasks });
  }, [plan, deepWork, lightTasks, onConfirm]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-24">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-primary/60" />
            <p className="text-[13px] text-foreground font-medium">Here&apos;s how I&apos;d spend today</p>
          </div>
          <span className="text-[9px] text-muted-foreground">
            {totalTasks} of {plan.meta?.workingSetSize ?? 0} tasks
          </span>
        </div>

        {/* AI narrative */}
        <div className="mb-4 px-3 py-3 rounded-xl bg-card border border-border">
          <p className="text-[11.5px] text-foreground/85 leading-relaxed">
            {plan.summary ?? ''}
          </p>
        </div>

        {/* ─── Worth noting (actionable nudge) ─── */}
        {plan.worthNoting != null && (
          <div className="mb-4 flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-amber-500/5 border border-amber-500/15">
            <AlertCircle size={12} className="text-amber-500/70 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-amber-500/80 leading-relaxed">
                {plan.worthNoting}
              </p>
            </div>
            <button className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold text-amber-600 hover:bg-amber-500/10 rounded-md transition-colors flex-shrink-0">
              <Plus size={9} /> Add to today
            </button>
          </div>
        )}

        {/* ─── Deep Work Section ─── */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-orange-500 flex items-center gap-1.5">
              <Flame size={11} /> Deep Work
            </h3>
            <span className="text-[9px] text-muted-foreground">{deepWork.length} tasks</span>
          </div>

          <div className="space-y-2">
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
          </div>

          {/* Add deep work from alternatives */}
          {deepAlts.length > 0 && (
            <div className="mt-2">
              {deepAlts.map((alt) => (
                <button
                  key={alt.id}
                  onClick={() => addDeepAlt(alt)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border/50 hover:border-primary/30 hover:bg-card/50 transition-all mt-1"
                >
                  <Plus size={10} className="text-primary/50" />
                  <span className="text-[11px] text-foreground/50 truncate">{alt.title}</span>
                  {alt.areaName && (
                    <span className="text-[8.5px] font-bold text-muted-foreground/40 uppercase tracking-wider ml-auto flex-shrink-0">
                      {alt.areaName}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ─── Light Tasks Section ─── */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
              <Zap size={11} /> Light Tasks
            </h3>
            <span className="text-[9px] text-muted-foreground">{lightTasks.length} tasks</span>
          </div>

          <div className="space-y-0.5">
            {lightTasks.map((item) => (
              <LightRow key={item.id} item={item} onRemove={() => removeLight(item.id)} />
            ))}
          </div>

          {/* Add light tasks from alternatives */}
          {lightAlts.length > 0 && (
            <div className="mt-2">
              {lightAlts.map((alt) => (
                <button
                  key={alt.id}
                  onClick={() => addLightAlt(alt)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border/50 hover:border-primary/30 hover:bg-card/50 transition-all mt-1"
                >
                  <Plus size={10} className="text-primary/50" />
                  <span className="text-[11px] text-foreground/50 truncate">{alt.title}</span>
                  {alt.areaName && (
                    <span className="text-[8.5px] font-bold text-muted-foreground/40 uppercase tracking-wider ml-auto flex-shrink-0">
                      {alt.areaName}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ─── All Alternatives (overflow) ─── */}
        {alternatives.length > 0 && (
          <div>
            <button
              onClick={() => setAltOpen(!altOpen)}
              className="flex items-center gap-2 w-full mb-2"
            >
              <div className="h-px flex-1 bg-border" />
              <span className="text-[8.5px] font-bold text-muted-foreground/50 uppercase tracking-[0.15em] flex items-center gap-1">
                All alternatives ({alternatives.length})
                <ChevronDown size={10} className={cn('transition-transform', altOpen && 'rotate-180')} />
              </span>
              <div className="h-px flex-1 bg-border" />
            </button>
            {altOpen && (
              <div className="space-y-1">
                {alternatives.map((alt) => (
                  <div
                    key={alt.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg border border-dashed border-border/40 hover:border-primary/30 hover:bg-card/50 transition-all"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[11px] font-medium text-foreground/60 leading-tight truncate">{alt.title}</p>
                        <span className={cn(
                          'text-[8px] font-bold uppercase tracking-wider flex-shrink-0',
                          alt.energy === 'deep' ? 'text-orange-500/50' : 'text-sky-400/50',
                        )}>
                          {alt.energy}
                        </span>
                      </div>
                      <p className="text-[9px] text-muted-foreground/40 mt-0.5 italic">{alt.reason}</p>
                    </div>
                    <button
                      onClick={() => alt.energy === 'deep' ? addDeepAlt(alt) : addLightAlt(alt)}
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
      </div>

      {/* ─── Sticky bottom bar ─── */}
      <div className="sticky bottom-0 px-4 py-3 border-t border-border bg-background/95 backdrop-blur-sm flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground">
          {totalTasks} task{totalTasks !== 1 ? 's' : ''} for today
        </p>
        <button
          onClick={handleConfirm}
          className="flex items-center gap-1.5 px-5 py-2.5 bg-primary text-primary-foreground text-[11px] font-bold rounded-lg hover:opacity-90 active:scale-95 transition-all shadow-sm"
        >
          <Play size={11} /> Start Executing
        </button>
      </div>
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
  const [expanded, setExpanded] = useState(index === 0);
  const deadline = formatDeadline(item.hardDeadline);
  const completedCount = item.subtasks?.filter((s: SubtaskItem) => s.completed).length ?? 0;
  const totalSubtasks = item.subtasks?.length ?? 0;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className={cn(
        'rounded-xl border transition-all',
        isDragging ? 'border-primary/30 opacity-70' : 'bg-card border-border',
      )}
    >
      <div className="flex items-start gap-2 px-3 py-3 cursor-grab active:cursor-grabbing">
        <button className="mt-1 p-0.5 text-muted-foreground/30 hover:text-muted-foreground" tabIndex={-1}>
          <GripVertical size={12} />
        </button>
        <div
          className={cn(
            'w-2 h-2 rounded-full mt-1.5 flex-shrink-0',
            index === 0 ? 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.3)]' : 'bg-primary/60'
          )}
        />
        <div className="flex-1 min-w-0" onClick={() => setExpanded(!expanded)}>
          <h3 className="text-[12.5px] font-medium text-foreground leading-tight">
            {item.projectTitle} — {item.taskTitle}
          </h3>

          {/* Metadata pills */}
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            {item.areaName && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[8.5px] font-bold text-muted-foreground uppercase tracking-wider bg-muted/50">
                {item.areaName}
              </span>
            )}
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
            {totalSubtasks > 0 && (
              <span className="text-[8.5px] text-muted-foreground">
                {completedCount}/{totalSubtasks} subtasks
              </span>
            )}
          </div>

          {/* Rationale — always visible */}
          {item.rationale && (
            <p className="text-[10px] text-muted-foreground leading-relaxed mt-1.5">
              <span className="text-primary font-bold text-[8.5px] uppercase tracking-widest">Why </span>
              {item.rationale}
            </p>
          )}

          {/* Expanded: continuity + subtasks */}
          {expanded && (
            <div className="mt-2 space-y-2">
              {item.continuityContext && (
                <p className="text-[10px] text-foreground/50 leading-relaxed italic">
                  {item.continuityContext}
                </p>
              )}

              {/* Subtasks */}
              {item.subtasks && item.subtasks.length > 0 && (
                <div className="space-y-0.5 pt-1 border-t border-border/50">
                  {item.subtasks.map((st: SubtaskItem) => (
                    <div key={st.id} className="flex items-center gap-2 py-1 px-1">
                      <div className={cn(
                        'w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0',
                        st.completed
                          ? 'bg-primary/20 border-primary/40 text-primary'
                          : 'border-border text-transparent',
                      )}>
                        <Check size={8} />
                      </div>
                      <span className={cn(
                        'text-[10.5px] leading-tight',
                        st.completed ? 'text-muted-foreground line-through' : 'text-foreground/80',
                      )}>
                        {st.title}
                      </span>
                      {st.effort && (
                        <span className="text-[8px] text-muted-foreground/50 font-bold uppercase ml-auto flex-shrink-0">
                          {EFFORT_LABELS[st.effort] ?? st.effort}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Expand hint */}
          {!expanded && (totalSubtasks > 0 || item.continuityContext) && (
            <button className="text-[9px] text-muted-foreground/40 mt-1 flex items-center gap-0.5 hover:text-muted-foreground transition-colors">
              <ChevronRight size={8} /> Details
            </button>
          )}
        </div>

        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="p-1 rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
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
          <p className="text-[11.5px] font-medium leading-tight truncate text-foreground">{item.title}</p>
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
          className="p-1 rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
          title="Not today"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

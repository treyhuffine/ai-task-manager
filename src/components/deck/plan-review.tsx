"use client";

import { useState, useCallback } from 'react';
import {
  GripVertical, ChevronDown, ChevronUp, X, Sparkles,
  Clock, Flame, Zap, Timer, Play,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DeckPlan, DeepWorkItem, LightTaskItem, DeckMeta } from '@/types/dashboard';

// ─── Shared constants (match task-row patterns) ─────────────

const EFFORT_LABELS: Record<string, string> = {
  trivial: 'XS',
  small: 'S',
  medium: 'M',
  large: 'L',
  epic: 'XL',
};

function formatDeadline(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 0 && days <= 7) return `In ${days}d`;
  if (days < 0) return `${Math.abs(days)}d overdue`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Unified review row type ─────────────────────────────────

interface ReviewRow {
  id: string;
  title: string;
  subtitle?: string;
  areaName?: string;
  energy: 'deep' | 'light';
  effort?: string;
  rationale?: string;
  estimatedMinutes?: number;
  hardDeadline?: string;
  isNew?: boolean;
  taskId: string;
  sortPosition?: number;
}

function planToRows(plan: DeckPlan): ReviewRow[] {
  const deepRows: ReviewRow[] = (plan.deepWork ?? []).map((d: DeepWorkItem) => ({
    id: d.id,
    title: `${d.projectTitle}: ${d.taskTitle}`,
    subtitle: d.continuityContext,
    areaName: d.areaName,
    energy: d.energy,
    effort: d.effort,
    rationale: d.rationale,
    estimatedMinutes: d.estimatedMinutes,
    hardDeadline: d.hardDeadline,
    taskId: d.taskId,
    sortPosition: d.sortPosition,
  }));
  const lightRows: ReviewRow[] = (plan.lightTasks ?? []).map((l: LightTaskItem) => ({
    id: l.id,
    title: l.title,
    areaName: l.areaName,
    energy: l.energy,
    effort: l.effort,
    estimatedMinutes: l.estimatedMinutes,
    hardDeadline: l.hardDeadline,
    isNew: l.isNew,
    taskId: l.taskId,
    sortPosition: l.sortPosition,
  }));
  return [...deepRows, ...lightRows];
}

// ─── Props ───────────────────────────────────────────────────

interface PlanReviewProps {
  plan: DeckPlan;
  onConfirm: (plan: DeckPlan) => void;
  onRemoveDeepWork: (id: string) => void;
  onRemoveLightTask: (id: string) => void;
}

// ─── Main component ─────────────────────────────────────────

export function PlanReview({ plan, onConfirm, onRemoveDeepWork, onRemoveLightTask }: PlanReviewProps) {
  const [rows, setRows] = useState<ReviewRow[]>(() => planToRows(plan));
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleDragStart = useCallback((idx: number) => {
    setDraggedIdx(idx);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === idx) return;
    setRows(prev => {
      const next = [...prev];
      const [moved] = next.splice(draggedIdx, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    setDraggedIdx(idx);
  }, [draggedIdx]);

  const handleDragEnd = useCallback(() => {
    setDraggedIdx(null);
  }, []);

  const handleRemove = useCallback((row: ReviewRow) => {
    setRows(prev => prev.filter(r => r.id !== row.id));
    if (row.energy === 'deep') {
      onRemoveDeepWork(row.id);
    } else {
      onRemoveLightTask(row.id);
    }
  }, [onRemoveDeepWork, onRemoveLightTask]);

  const handleConfirm = useCallback(() => {
    const deepWork: DeepWorkItem[] = [];
    const lightTasks: LightTaskItem[] = [];

    for (const row of rows) {
      if (row.energy === 'deep') {
        const original = (plan.deepWork ?? []).find((d: DeepWorkItem) => d.id === row.id);
        if (original) deepWork.push(original);
      } else {
        const original = (plan.lightTasks ?? []).find((l: LightTaskItem) => l.id === row.id);
        if (original) lightTasks.push(original);
      }
    }

    onConfirm({ ...plan, deepWork, lightTasks });
  }, [rows, plan, onConfirm]);

  const moveUp = useCallback((idx: number) => {
    if (idx === 0) return;
    setRows(prev => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }, []);

  const moveDown = useCallback((idx: number) => {
    setRows(prev => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }, []);

  return (
    <div className="px-4 pt-4 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div>
          <p className="text-[12px] text-foreground font-medium">
            Here&apos;s what I&apos;d suggest for today
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Reorder, tweak, remove. Then start executing.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
          <Sparkles size={10} className="text-primary/50" />
          {rows.length} of {plan.meta?.workingSetSize ?? 0} tasks
        </div>
      </div>

      {/* AI summary */}
      {plan.summary && (
        <p className="text-[11px] text-foreground/80 leading-relaxed mb-3 mt-2">
          {plan.summary}
        </p>
      )}

      {/* Reorderable list */}
      <div className="mb-4">
        {rows.map((row, idx) => (
          <ReviewRowCard
            key={row.id}
            row={row}
            index={idx}
            totalRows={rows.length}
            meta={plan.meta ?? { workingSetSize: 0 }}
            isExpanded={expandedId === row.id}
            isDragging={draggedIdx === idx}
            onToggleExpand={() => setExpandedId(expandedId === row.id ? null : row.id)}
            onDragStart={() => handleDragStart(idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDragEnd={handleDragEnd}
            onMoveUp={() => moveUp(idx)}
            onMoveDown={() => moveDown(idx)}
            onRemove={() => handleRemove(row)}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <p className="text-[9px] text-muted-foreground">
          {rows.length} task{rows.length !== 1 ? 's' : ''} for today
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

// ─── Row component ──────────────────────────────────────────

function ReviewRowCard({
  row,
  index,
  totalRows,
  meta,
  isExpanded,
  isDragging,
  onToggleExpand,
  onDragStart,
  onDragOver,
  onDragEnd,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  row: ReviewRow;
  index: number;
  totalRows: number;
  meta: DeckMeta;
  isExpanded: boolean;
  isDragging: boolean;
  onToggleExpand: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const EnergyIcon = row.energy === 'deep' ? Flame : Zap;
  const deadline = formatDeadline(row.hardDeadline);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className={cn(
        'rounded-lg transition-all group border border-transparent',
        isDragging
          ? 'bg-primary/5 border-primary/20 opacity-70'
          : 'hover:bg-card hover:border-border',
      )}
    >
      {/* Main row */}
      <div className="flex items-start gap-1.5 px-2 py-2 cursor-grab active:cursor-grabbing">
        {/* Drag handle — always visible */}
        <button
          className="mt-1 p-0.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          tabIndex={-1}
        >
          <GripVertical size={12} />
        </button>

        {/* Index */}
        <span className="text-[10px] font-mono text-muted-foreground w-4 text-right mt-1 flex-shrink-0">
          {index + 1}
        </span>

        {/* Content */}
        <div className="min-w-0 flex-1" onClick={onToggleExpand}>
          <p className="text-[12px] font-medium leading-tight line-clamp-2 text-foreground">
            {row.title}
          </p>

          {/* Metadata row */}
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            {/* Area */}
            {row.areaName && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[8.5px] font-bold text-muted-foreground uppercase tracking-wider bg-muted/50">
                {row.areaName}
              </span>
            )}

            {/* Energy pill */}
            <span className={cn(
              'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider',
              row.energy === 'deep' ? 'text-orange-500' : 'text-sky-400',
            )}>
              <EnergyIcon size={8} />
              {row.energy}
            </span>

            {/* Effort pill */}
            {row.effort && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[8.5px] font-bold text-muted-foreground uppercase tracking-wider">
                {EFFORT_LABELS[row.effort] ?? row.effort}
              </span>
            )}

            {/* Time estimate */}
            {row.estimatedMinutes != null && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8.5px] text-muted-foreground">
                <Clock size={8} /> ~{row.estimatedMinutes}m
              </span>
            )}

            {/* Deadline */}
            {deadline && (
              <span className={cn(
                'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider',
                row.hardDeadline && new Date(row.hardDeadline) < new Date()
                  ? 'text-destructive'
                  : 'text-amber-500',
              )}>
                <Timer size={8} /> {deadline}
              </span>
            )}

            {/* New badge */}
            {row.isNew && (
              <span className="text-[7.5px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                new
              </span>
            )}

            {/* Sort position context */}
            {row.sortPosition != null && (
              <span className="text-[8px] text-muted-foreground/40" title={`#${row.sortPosition} in your working set of ${meta.workingSetSize}`}>
                #{row.sortPosition} of {meta.workingSetSize}
              </span>
            )}
          </div>
        </div>

        {/* Actions — always visible */}
        <div className="flex items-center gap-0.5 flex-shrink-0 mt-0.5">
          <button
            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
            disabled={index === 0}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-20 transition-colors"
            title="Move up"
          >
            <ChevronUp size={12} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
            disabled={index === totalRows - 1}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-20 transition-colors"
            title="Move down"
          >
            <ChevronDown size={12} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Not today"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {isExpanded && (row.rationale || row.subtitle) && (
        <div className="px-2 pb-2 ml-[42px]">
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            {row.rationale || row.subtitle}
          </p>
        </div>
      )}
    </div>
  );
}

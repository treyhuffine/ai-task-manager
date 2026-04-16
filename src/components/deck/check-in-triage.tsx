"use client";

import { useState } from 'react';
import {
  Check, Pencil, CheckCheck, ArrowRight, Clock,
  Flame, Zap, MapPin, Archive, SkipForward,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AreaSelect } from '@/components/shared/area-select';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import type { TriageItem, TriageAction, PlacementZone } from '@/types/dashboard';

// ─── Constants (match task-row patterns) ─────────────────────

const EFFORT_LABELS: Record<string, string> = {
  trivial: 'XS',
  small: 'S',
  medium: 'M',
  large: 'L',
  epic: 'XL',
};

type Energy = 'deep' | 'light';
type Effort = 'trivial' | 'small' | 'medium' | 'large' | 'epic';

const ENERGY_CYCLE: (Energy | null)[] = ['deep', 'light', null];
const EFFORT_CYCLE: (Effort | null)[] = ['trivial', 'small', 'medium', 'large', 'epic', null];
const PLACEMENT_CYCLE: (PlacementZone | null)[] = ['top', 'mid', 'low', 'backlog', null];

const PLACEMENT_LABELS: Record<string, string> = {
  top: 'Top',
  mid: 'Mid',
  low: 'Low',
  backlog: 'Backlog',
};

const ENERGY_COLORS: Record<string, string> = {
  deep: 'text-orange-500',
  light: 'text-sky-400',
};

const ENERGY_ICONS: Record<string, typeof Flame> = {
  deep: Flame,
  light: Zap,
};

const ACTION_LABELS: Record<TriageAction, string> = {
  promote_task: 'Task',
  promote_note: 'Note',
  append_note: 'Append',
  boomerang: 'Boomerang',
  dismiss: 'Dismiss',
};

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

// ─── Props ───────────────────────────────────────────────────

interface CheckInTriageProps {
  items: TriageItem[];
  onAccept: (id: string) => void;
  onSkipItem: (id: string) => void;
  onArchive: (id: string) => void;
  onEdit: (id: string) => void;
  onAcceptAll: () => void;
  onSkip: () => void;
  onDone: () => void;
  onUpdateRecommendation?: (id: string, field: string, value: unknown) => void;
}

// ─── Main component ─────────────────────────────────────────

export function CheckInTriage({ items, onAccept, onSkipItem, onArchive, onEdit, onAcceptAll, onSkip, onDone, onUpdateRecommendation }: CheckInTriageProps) {
  const pending = items.filter(i => !i.resolved);

  if (items.length === 0) return null;

  return (
    <div className="px-4 pt-4 pb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[12px] text-muted-foreground">
          {pending.length > 0
            ? `${pending.length} capture${pending.length !== 1 ? 's' : ''} need${pending.length === 1 ? 's' : ''} your call`
            : 'All sorted'}
        </p>
        <div className="flex items-center gap-2">
          {pending.length >= 3 && (
            <button
              onClick={onAcceptAll}
              className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold text-primary hover:bg-primary/5 rounded transition-colors"
            >
              <CheckCheck size={10} /> Accept all
            </button>
          )}
          {pending.length > 0 && (
            <button
              onClick={onSkip}
              className="text-[9px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Skip
            </button>
          )}
        </div>
      </div>

      <div className="space-y-0.5">
        {items.map((item) => (
          <TriageCard
            key={item.id}
            item={item}
            onAccept={() => onAccept(item.id)}
            onSkipItem={() => onSkipItem(item.id)}
            onArchive={() => onArchive(item.id)}
            onEdit={() => onEdit(item.id)}
            onUpdateField={(field, value) => onUpdateRecommendation?.(item.id, field, value)}
          />
        ))}
      </div>

      {pending.length === 0 && (
        <div className="mt-3 flex justify-end">
          <button
            onClick={onDone}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-lg hover:opacity-90 active:scale-95 transition-all"
          >
            Show my plan <ArrowRight size={10} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Card component ─────────────────────────────────────────

function TriageCard({
  item,
  onAccept,
  onSkipItem,
  onArchive,
  onEdit,
  onUpdateField,
}: {
  item: TriageItem;
  onAccept: () => void;
  onSkipItem: () => void;
  onArchive: () => void;
  onEdit: () => void;
  onUpdateField: (field: string, value: unknown) => void;
}) {
  const [showRationale, setShowRationale] = useState(false);

  const energy = item.recommendation.energy ?? null;
  const effort = item.recommendation.effort ?? null;
  const placement = item.recommendation.placement ?? null;

  const cycleEnergy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const idx = ENERGY_CYCLE.indexOf(energy as Energy | null);
    const next = ENERGY_CYCLE[(idx + 1) % ENERGY_CYCLE.length];
    onUpdateField('energy', next);
  };

  const cycleEffort = (e: React.MouseEvent) => {
    e.stopPropagation();
    const idx = EFFORT_CYCLE.indexOf(effort as Effort | null);
    const next = EFFORT_CYCLE[(idx + 1) % EFFORT_CYCLE.length];
    onUpdateField('effort', next);
  };

  const cyclePlacement = (e: React.MouseEvent) => {
    e.stopPropagation();
    const idx = PLACEMENT_CYCLE.indexOf(placement);
    const next = PLACEMENT_CYCLE[(idx + 1) % PLACEMENT_CYCLE.length];
    onUpdateField('placement', next);
  };

  const EnergyIcon = energy ? ENERGY_ICONS[energy] : null;
  const showQuickActions = !item.resolved && item.recommendation.action === 'promote_task';

  return (
    <div
      className={cn(
        'group rounded-lg transition-all border border-transparent px-2 py-2',
        item.resolved
          ? 'opacity-50'
          : 'hover:bg-card hover:border-border',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-foreground leading-tight truncate">
            {item.rawText}
          </p>

          {/* Metadata row with quick actions */}
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            {/* AI recommendation action type */}
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[8.5px] font-bold text-primary/80 uppercase tracking-wider">
              {ACTION_LABELS[item.recommendation.action]}
            </span>

            {/* Area — editable for tasks, static for others */}
            {showQuickActions ? (
              <AreaSelect
                value={item.recommendation.area ?? null}
                onChange={(areaId) => onUpdateField('area', areaId)}
              />
            ) : item.recommendation.area ? (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[8.5px] font-bold text-muted-foreground uppercase tracking-wider bg-muted/50">
                {item.recommendation.area}
              </span>
            ) : null}

            {/* Energy pill — cycleable (only for tasks) */}
            {showQuickActions && (
              <button
                onClick={cycleEnergy}
                className={cn(
                  'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider transition-colors hover:bg-muted',
                  energy ? ENERGY_COLORS[energy] : 'text-muted-foreground/40',
                )}
                title={`Energy: ${energy ?? 'unset'} (click to cycle)`}
              >
                {EnergyIcon && <EnergyIcon size={8} />}
                {energy ?? '~'}
              </button>
            )}

            {/* Effort pill — cycleable (only for tasks) */}
            {showQuickActions && (
              <button
                onClick={cycleEffort}
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[8.5px] font-bold text-muted-foreground uppercase tracking-wider transition-colors hover:bg-muted"
                title={`Effort: ${effort ?? 'unset'} (click to cycle)`}
              >
                {effort ? (EFFORT_LABELS[effort] ?? effort) : '~'}
              </button>
            )}

            {/* Placement zone pill — cycleable (only for tasks) */}
            {showQuickActions && (
              <button
                onClick={cyclePlacement}
                className={cn(
                  'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider transition-colors hover:bg-muted',
                  placement ? 'text-foreground' : 'text-muted-foreground/40',
                )}
                title={`Placement: ${placement ?? 'unset'} (click to cycle)`}
              >
                <MapPin size={8} />
                {placement ? PLACEMENT_LABELS[placement] : '~'}
              </button>
            )}

            {/* Time ago */}
            <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
              <Clock size={8} /> {timeAgo(item.createdAt)}
            </span>
          </div>
        </div>

        {/* Accept / Edit / Skip / Archive — always visible */}
        {!item.resolved && (
          <TooltipProvider>
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onAccept}
                    className="p-1.5 rounded-md text-primary hover:bg-primary/10 transition-colors"
                  >
                    <Check size={12} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Accept</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onEdit}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <Pencil size={11} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Edit</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onSkipItem}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <SkipForward size={11} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Skip and handle later</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onArchive}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-muted-foreground/80 hover:bg-muted transition-colors"
                  >
                    <Archive size={11} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Archive</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        )}

        {item.resolved && (
          <span className="text-[9px] text-primary font-medium flex-shrink-0 mt-0.5">
            <Check size={10} className="inline" />
          </span>
        )}
      </div>

      {/* Rationale toggle */}
      {!item.resolved && item.recommendation.rationale && (
        <button
          onClick={() => setShowRationale(!showRationale)}
          className="text-[9px] text-muted-foreground/60 hover:text-muted-foreground mt-1 ml-0.5 transition-colors"
        >
          {showRationale ? 'Hide reasoning' : 'Why?'}
        </button>
      )}

      {showRationale && item.recommendation.rationale && (
        <p className="mt-1 ml-0.5 text-[10px] text-muted-foreground leading-relaxed">
          {item.recommendation.rationale}
        </p>
      )}
    </div>
  );
}

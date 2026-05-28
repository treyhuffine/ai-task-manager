"use client";

import { useState, useCallback } from 'react';
import {
  Archive, SkipForward, Clock,
  Flame, Zap, MapPin, Inbox,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AreaSelect } from '@/components/shared/area-select';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { TaskActions, NoteActions } from './promote-actions';
import { StreamAttachments } from './stream-attachments';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { useStream, useDismissStream, useUpdateStream } from '@/hooks/use-stream';
import { useCreateTask } from '@/hooks/use-tasks';
import { useCreateNote, useUpdateNote } from '@/hooks/use-notes';
import type { StreamRecord } from '@/db/types';

// ─── Constants ───────────────────────────────────────────────

type Energy = 'deep' | 'light';
type Effort = 'trivial' | 'small' | 'medium' | 'large' | 'epic';
type PlacementZone = 'top' | 'mid' | 'low' | 'backlog';

const EFFORT_LABELS: Record<string, string> = {
  trivial: 'XS', small: 'S', medium: 'M', large: 'L', epic: 'XL',
};
const ENERGY_CYCLE: (Energy | null)[] = ['deep', 'light', null];
const EFFORT_CYCLE: (Effort | null)[] = ['trivial', 'small', 'medium', 'large', 'epic', null];
const PLACEMENT_CYCLE: (PlacementZone | null)[] = ['top', 'mid', 'low', 'backlog', null];
const PLACEMENT_LABELS: Record<string, string> = {
  top: 'Top', mid: 'Mid', low: 'Low', backlog: 'Backlog',
};
const ENERGY_COLORS: Record<string, string> = { deep: 'text-orange-500', light: 'text-sky-400' };
const ENERGY_ICONS: Record<string, typeof Flame> = { deep: Flame, light: Zap };

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

// ─── Local state per item (for quick-action overrides before promoting) ──

interface ItemOverrides {
  energy?: Energy | null;
  effort?: Effort | null;
  placement?: PlacementZone | null;
  areaId?: string | null;
}

// ─── Props ───────────────────────────────────────────────────

interface StreamTriageProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ─── Main component ─────────────────────────────────────────

export function StreamTriage({ open, onOpenChange }: StreamTriageProps) {
  const { data: pendingItems } = useStream({ status: 'pending' });
  const dismissStream = useDismissStream();
  const updateStream = useUpdateStream();
  const createTask = useCreateTask();
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const [overrides, setOverrides] = useState<Record<string, ItemOverrides>>({});
  const [processed, setProcessed] = useState<Set<string>>(new Set());

  const items = pendingItems ?? [];
  const remaining = items.filter(i => !processed.has(i.id));

  const updateOverride = useCallback((id: string, field: string, value: unknown) => {
    setOverrides(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  }, []);

  const handlePromoteToTask = useCallback((item: StreamRecord) => {
    createTask.mutate({
      rawInput: item.rawText,
      title: item.rawText.slice(0, 200),
      body: item.rawText,
      attachments: item.attachments ?? [],
      ...(overrides[item.id]?.energy ? { energy: overrides[item.id].energy } : {}),
      ...(overrides[item.id]?.effort ? { effort: overrides[item.id].effort } : {}),
      ...(overrides[item.id]?.areaId ? { areaId: overrides[item.id].areaId } : {}),
    }, {
      onSuccess: (task) => {
        updateStream.mutate({
          id: item.id,
          status: 'promoted',
          promotedToType: 'task',
          promotedToId: task.id,
          promotedAt: new Date().toISOString(),
        } as Parameters<typeof updateStream.mutate>[0]);
        setProcessed(prev => new Set(prev).add(item.id));
      },
    });
  }, [createTask, updateStream, overrides]);

  const handlePromoteToNote = useCallback((item: StreamRecord) => {
    createNote.mutate({
      body: item.rawText,
      attachments: item.attachments ?? [],
    }, {
      onSuccess: (note) => {
        updateStream.mutate({
          id: item.id,
          status: 'promoted',
          promotedToType: 'note',
          promotedToId: note.id,
          promotedAt: new Date().toISOString(),
        } as Parameters<typeof updateStream.mutate>[0]);
        setProcessed(prev => new Set(prev).add(item.id));
      },
    });
  }, [createNote, updateStream]);

  const handleMergeIntoTask = useCallback((item: StreamRecord, targetTaskId: string) => {
    createTask.mutate({
      rawInput: item.rawText,
      title: item.rawText.slice(0, 200),
      body: item.rawText,
      parentId: targetTaskId,
      attachments: item.attachments ?? [],
      ...(overrides[item.id]?.energy ? { energy: overrides[item.id].energy } : {}),
      ...(overrides[item.id]?.effort ? { effort: overrides[item.id].effort } : {}),
      ...(overrides[item.id]?.areaId ? { areaId: overrides[item.id].areaId } : {}),
    }, {
      onSuccess: (task) => {
        updateStream.mutate({
          id: item.id,
          status: 'promoted',
          promotedToType: 'task',
          promotedToId: task.id,
          promotedAt: new Date().toISOString(),
        } as Parameters<typeof updateStream.mutate>[0]);
        setProcessed(prev => new Set(prev).add(item.id));
      },
    });
  }, [createTask, updateStream, overrides]);

  const handleMergeIntoNote = useCallback((item: StreamRecord, targetNoteId: string) => {
    updateNote.mutate({
      id: targetNoteId,
      body: item.rawText,
      attachments: item.attachments ?? [],
    } as Parameters<typeof updateNote.mutate>[0], {
      onSuccess: () => {
        updateStream.mutate({
          id: item.id,
          status: 'promoted',
          promotedToType: 'note',
          promotedToId: targetNoteId,
          promotedAt: new Date().toISOString(),
        } as Parameters<typeof updateStream.mutate>[0]);
        setProcessed(prev => new Set(prev).add(item.id));
      },
    });
  }, [updateNote, updateStream]);

  const handleSkip = useCallback((id: string) => {
    setProcessed(prev => new Set(prev).add(id));
  }, []);

  const handleArchive = useCallback((id: string) => {
    dismissStream.mutate(id);
    setProcessed(prev => new Set(prev).add(id));
  }, [dismissStream]);

  const handleClose = useCallback(() => {
    setProcessed(new Set());
    setOverrides({});
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="right" className="w-full data-[side=right]:sm:max-w-[640px] flex flex-col">
        <SheetHeader>
          <SheetTitle className="text-[13px]">Triage</SheetTitle>
          <SheetDescription className="text-[10px]">
            {remaining.length > 0
              ? `${remaining.length} capture${remaining.length !== 1 ? 's' : ''} to process`
              : 'All clear'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 -mx-0">
          {remaining.length === 0 && items.length > 0 && (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
              <Inbox size={20} className="opacity-30" />
              <p className="text-[11px]">Inbox clear</p>
            </div>
          )}

          {remaining.length === 0 && items.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
              <Inbox size={20} className="opacity-30" />
              <p className="text-[11px]">No pending captures</p>
            </div>
          )}

          <div className="space-y-0.5">
            {remaining.map((item) => (
              <TriageRow
                key={item.id}
                item={item}
                overrides={overrides[item.id] ?? {}}
                onUpdateOverride={(field, value) => updateOverride(item.id, field, value)}
                onPromoteToTask={() => handlePromoteToTask(item)}
                onMergeIntoTask={(taskId) => handleMergeIntoTask(item, taskId)}
                onPromoteToNote={() => handlePromoteToNote(item)}
                onMergeIntoNote={(noteId) => handleMergeIntoNote(item, noteId)}
                onSkip={() => handleSkip(item.id)}
                onArchive={() => handleArchive(item.id)}
              />
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Row component ──────────────────────────────────────────

function TriageRow({
  item,
  overrides,
  onUpdateOverride,
  onPromoteToTask,
  onMergeIntoTask,
  onPromoteToNote,
  onMergeIntoNote,
  onSkip,
  onArchive,
}: {
  item: StreamRecord;
  overrides: ItemOverrides;
  onUpdateOverride: (field: string, value: unknown) => void;
  onPromoteToTask: () => void;
  onMergeIntoTask: (taskId: string) => void;
  onPromoteToNote: () => void;
  onMergeIntoNote: (noteId: string) => void;
  onSkip: () => void;
  onArchive: () => void;
}) {
  const energy = overrides.energy ?? null;
  const effort = overrides.effort ?? null;
  const placement = overrides.placement ?? null;

  const cycleEnergy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const idx = ENERGY_CYCLE.indexOf(energy);
    onUpdateOverride('energy', ENERGY_CYCLE[(idx + 1) % ENERGY_CYCLE.length]);
  };

  const cycleEffort = (e: React.MouseEvent) => {
    e.stopPropagation();
    const idx = EFFORT_CYCLE.indexOf(effort);
    onUpdateOverride('effort', EFFORT_CYCLE[(idx + 1) % EFFORT_CYCLE.length]);
  };

  const cyclePlacement = (e: React.MouseEvent) => {
    e.stopPropagation();
    const idx = PLACEMENT_CYCLE.indexOf(placement);
    onUpdateOverride('placement', PLACEMENT_CYCLE[(idx + 1) % PLACEMENT_CYCLE.length]);
  };

  const EnergyIcon = energy ? ENERGY_ICONS[energy] : null;

  return (
    <div className="group rounded-lg transition-all border border-transparent px-2 py-2 hover:bg-card hover:border-border">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-foreground leading-tight">
            {item.rawText}
          </p>

          <StreamAttachments attachments={item.attachments} />

          {/* Quick action pills */}
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            {/* Area */}
            <AreaSelect
              value={overrides.areaId ?? null}
              onChange={(areaId) => onUpdateOverride('areaId', areaId)}
            />

            {/* Energy */}
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

            {/* Effort */}
            <button
              onClick={cycleEffort}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[8.5px] font-bold text-muted-foreground uppercase tracking-wider transition-colors hover:bg-muted"
              title={`Effort: ${effort ?? 'unset'} (click to cycle)`}
            >
              {effort ? (EFFORT_LABELS[effort] ?? effort) : '~'}
            </button>

            {/* Placement */}
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

            {/* Time */}
            <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
              <Clock size={8} /> {timeAgo(item.createdAt)}
            </span>
          </div>
        </div>

        {/* Actions */}
        <TooltipProvider>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <TaskActions
              onPromote={onPromoteToTask}
              onMerge={onMergeIntoTask}
            />
            <NoteActions
              onPromote={onPromoteToNote}
              onMerge={onMergeIntoNote}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onSkip}
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
      </div>
    </div>
  );
}

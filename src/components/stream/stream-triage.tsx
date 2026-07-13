"use client";

/**
 * The review surface (spec §3.12): "Needs your call" first — the agent's
 * proposals, pre-filled, one tap to accept, correction affordances that
 * feed telemetry — then any untriaged captures with the manual controls.
 *
 * Accept-all is offered only for groups made exclusively of low-risk
 * dispositions (journal / dismiss / promote). Merges and combines are never
 * inside a blind accept-all.
 */

import { useState, useCallback } from 'react';
import {
  Archive, BookOpen, Check, ChevronDown, ChevronRight, Clock,
  Flame, Inbox, Pencil, Target, FileText, Undo2, Zap, CornerUpRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AreaSelect } from '@/components/shared/area-select';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { TaskActions, NoteActions } from './promote-actions';
import { StreamAttachments } from './stream-attachments';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  useStream,
  useProposedDecisions,
  useAcceptDecision,
  useCorrectDecision,
  useUndoDecision,
  useTriageDecide,
} from '@/hooks/use-stream';
import type { TriageDecisionWithItems } from '@/lib/api/stream';
import type { StreamRecord, TriageDisposition } from '@/db/types';

// ─── Shared bits ─────────────────────────────────────────────

type Energy = 'deep' | 'light';
type Effort = 'trivial' | 'small' | 'medium' | 'large' | 'epic';

const EFFORT_LABELS: Record<string, string> = {
  trivial: 'XS', small: 'S', medium: 'M', large: 'L', epic: 'XL',
};
const ENERGY_CYCLE: (Energy | null)[] = ['deep', 'light', null];
const EFFORT_CYCLE: (Effort | null)[] = ['trivial', 'small', 'medium', 'large', 'epic', null];
const ENERGY_COLORS: Record<string, string> = { deep: 'text-orange-500', light: 'text-sky-400' };
const ENERGY_ICONS: Record<string, typeof Flame> = { deep: Flame, light: Zap };

/** Wrongly merging is the most trust-destroying operation — merges and
 *  combines never ride inside a blind accept-all. */
const LOW_RISK_DISPOSITIONS: TriageDisposition[] = [
  'journal', 'dismiss', 'promote_task', 'promote_note', 'incubate',
];

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

/** Proposals grouped by the sweep that made them (newest pass first),
 *  chat/one-off suggestions (no pass) last. */
function groupByPass(decisions: TriageDecisionWithItems[]): Array<{
  passId: string | null;
  decisions: TriageDecisionWithItems[];
}> {
  const groups = new Map<string | null, TriageDecisionWithItems[]>();
  for (const d of decisions) {
    const key = d.passId ?? null;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  return [...groups.entries()]
    .map(([passId, ds]) => ({ passId, decisions: ds }))
    .sort((a, b) => {
      if (a.passId === null) return 1;
      if (b.passId === null) return -1;
      return b.decisions[0].createdAt.localeCompare(a.decisions[0].createdAt);
    });
}

function proposalHeadline(d: TriageDecisionWithItems): { icon: typeof Target; text: string } {
  switch (d.disposition) {
    case 'promote_task':
      return { icon: Target, text: `Make a task: ${d.draft?.title ?? ''}` };
    case 'promote_note':
      return { icon: FileText, text: `Make a note${d.draft?.title ? `: ${d.draft.title}` : ''}` };
    case 'merge_task':
      return { icon: Target, text: `Add to ${d.targetTitle ?? 'a task'}` };
    case 'merge_note':
      return { icon: FileText, text: `Add to ${d.targetTitle ?? 'a note'}` };
    case 'combine_task':
      return { icon: Target, text: `Combine ${d.streamItemIds.length} thoughts into one task: ${d.draft?.title ?? ''}` };
    case 'combine_note':
      return { icon: FileText, text: `Combine ${d.streamItemIds.length} thoughts into one note${d.draft?.title ? `: ${d.draft.title}` : ''}` };
    case 'journal':
      return { icon: BookOpen, text: 'Keep as a thought' };
    case 'dismiss':
      return { icon: Archive, text: 'Set aside' };
    case 'incubate':
      return {
        icon: Clock,
        text: `Keep for later${d.draft?.resurfaceAt ? ` (back ${new Date(d.draft.resurfaceAt).toLocaleDateString()})` : ''}`,
      };
  }
}

const REROUTE_OPTIONS: Array<{ disposition: TriageDisposition; label: string; icon: typeof Target }> = [
  { disposition: 'promote_task', label: 'Make it a task', icon: Target },
  { disposition: 'promote_note', label: 'Make it a note', icon: FileText },
  { disposition: 'journal', label: 'Keep as a thought', icon: BookOpen },
  { disposition: 'dismiss', label: 'Set aside', icon: Archive },
];

// ─── Proposal card ───────────────────────────────────────────

function ProposalCard({ decision }: { decision: TriageDecisionWithItems }) {
  const accept = useAcceptDecision();
  const correct = useCorrectDecision();
  const undo = useUndoDecision();
  const [showSources, setShowSources] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(decision.draft?.title ?? '');
  const [errorText, setErrorText] = useState<string | null>(null);

  const headline = proposalHeadline(decision);
  const Icon = headline.icon;
  const canEditTitle = decision.disposition.startsWith('promote_') || decision.disposition.startsWith('combine_');
  const canReroute = decision.streamItemIds.length === 1;

  const handleAccept = useCallback(() => {
    accept.mutate(decision.id, {
      onError: (err) => setErrorText(err instanceof Error ? err.message : 'Could not apply this.'),
    });
  }, [accept, decision.id]);

  const handleSaveTitle = useCallback(() => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === decision.draft?.title) return;
    // A material edit is a correction: same disposition, user's title.
    correct.mutate({
      id: decision.id,
      correction: {
        disposition: decision.disposition,
        targetType: decision.targetType,
        targetId: decision.targetId,
        draft: { ...(decision.draft ?? {}), title: trimmed },
      },
    });
  }, [correct, decision, titleDraft]);

  return (
    <div className="rounded-lg border border-border bg-card/50 px-3 py-2.5 space-y-1.5">
      <div className="flex items-start gap-2">
        <Icon size={12} className="text-primary mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={handleSaveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveTitle();
                if (e.key === 'Escape') { setTitleDraft(decision.draft?.title ?? ''); setEditingTitle(false); }
              }}
              className="w-full text-[11.5px] font-medium bg-background border border-border rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-primary"
            />
          ) : (
            <p className="text-[11.5px] font-medium text-foreground leading-snug">
              {headline.text}
              {canEditTitle && (
                <button
                  onClick={() => setEditingTitle(true)}
                  className="ml-1.5 inline-flex text-muted-foreground/50 hover:text-foreground align-middle"
                  title="Edit the title"
                >
                  <Pencil size={9} />
                </button>
              )}
            </p>
          )}
          {decision.rationale && (
            <p className="text-[10px] text-muted-foreground italic leading-snug mt-0.5">{decision.rationale}</p>
          )}
        </div>
      </div>

      {/* Source captures: provenance on demand */}
      <button
        onClick={() => setShowSources((s) => !s)}
        className="flex items-center gap-1 text-[9px] text-muted-foreground/70 hover:text-foreground transition-colors ml-5"
      >
        {showSources ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
        {decision.items.length === 1 ? 'the capture' : `${decision.items.length} captures`}
      </button>
      {showSources && (
        <div className="ml-5 space-y-1">
          {decision.items.map((item) => (
            <p key={item.id} className="text-[10px] text-muted-foreground leading-snug border-l-2 border-border pl-2">
              {item.rawText}
            </p>
          ))}
        </div>
      )}

      {errorText && (
        <p className="ml-5 text-[9.5px] text-destructive">{errorText}</p>
      )}

      {/* Actions: accept is primary, correction is one hop away */}
      <div className="flex items-center gap-1.5 ml-5 pt-0.5">
        <button
          onClick={handleAccept}
          disabled={accept.isPending}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-[10px] font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <Check size={10} />
          Looks right
        </button>

        {canReroute && (
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <CornerUpRight size={10} />
                Instead…
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-44 p-0" sideOffset={4}>
              <div className="py-1">
                {REROUTE_OPTIONS.filter((o) => o.disposition !== decision.disposition).map((o) => (
                  <button
                    key={o.disposition}
                    onClick={() =>
                      correct.mutate({
                        id: decision.id,
                        correction: { disposition: o.disposition, draft: decision.draft ?? null },
                      })
                    }
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[10.5px] text-foreground hover:bg-muted transition-colors"
                  >
                    <o.icon size={11} className="text-muted-foreground" />
                    {o.label}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}

        <button
          onClick={() => undo.mutate(decision.id)}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Leave the capture as it was"
        >
          <Undo2 size={10} />
          Not this
        </button>

        <span className="flex-1" />
        <span className="text-[9px] text-muted-foreground/60 flex items-center gap-0.5">
          <Clock size={8} /> {timeAgo(decision.createdAt)}
        </span>
      </div>
    </div>
  );
}

// ─── Manual triage row (untriaged captures) ──────────────────

interface ItemOverrides {
  energy?: Energy | null;
  effort?: Effort | null;
  areaId?: string | null;
}

function ManualRow({
  item,
  overrides,
  onUpdateOverride,
  onDecide,
  onMergeTask,
  onMergeNote,
}: {
  item: StreamRecord;
  overrides: ItemOverrides;
  onUpdateOverride: (field: string, value: unknown) => void;
  onDecide: (disposition: TriageDisposition) => void;
  onMergeTask: (taskId: string) => void;
  onMergeNote: (noteId: string) => void;
}) {
  const energy = overrides.energy ?? null;
  const effort = overrides.effort ?? null;

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

  const EnergyIcon = energy ? ENERGY_ICONS[energy] : null;

  return (
    <div className="group rounded-lg transition-all border border-transparent px-2 py-2 hover:bg-card hover:border-border">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-foreground leading-tight">
            {item.rawText}
          </p>

          <StreamAttachments attachments={item.attachments} />

          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            <AreaSelect
              value={overrides.areaId ?? null}
              onChange={(areaId) => onUpdateOverride('areaId', areaId)}
            />
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
            <button
              onClick={cycleEffort}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[8.5px] font-bold text-muted-foreground uppercase tracking-wider transition-colors hover:bg-muted"
              title={`Effort: ${effort ?? 'unset'} (click to cycle)`}
            >
              {effort ? (EFFORT_LABELS[effort] ?? effort) : '~'}
            </button>
            <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
              <Clock size={8} /> {timeAgo(item.createdAt)}
            </span>
          </div>
        </div>

        <TooltipProvider>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <TaskActions onPromote={() => onDecide('promote_task')} onMerge={onMergeTask} />
            <NoteActions onPromote={() => onDecide('promote_note')} onMerge={onMergeNote} />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onDecide('journal')}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-violet-500 hover:bg-muted transition-colors"
                >
                  <BookOpen size={11} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Keep as a thought</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onDecide('dismiss')}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-muted-foreground/80 hover:bg-muted transition-colors"
                >
                  <Archive size={11} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Set aside</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
    </div>
  );
}

// ─── Main sheet ──────────────────────────────────────────────

interface StreamTriageProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StreamTriage({ open, onOpenChange }: StreamTriageProps) {
  const { data: proposals } = useProposedDecisions();
  const { data: pendingItems } = useStream({ status: 'pending' });
  const decide = useTriageDecide();
  const accept = useAcceptDecision();
  const [overrides, setOverrides] = useState<Record<string, ItemOverrides>>({});

  const proposalList = proposals ?? [];
  const pending = pendingItems ?? [];

  const updateOverride = useCallback((id: string, field: string, value: unknown) => {
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }, []);

  const handleManualDecide = useCallback(
    (item: StreamRecord, disposition: TriageDisposition, targetType?: 'task' | 'note', targetId?: string) => {
      const o = overrides[item.id] ?? {};
      decide.mutate({
        disposition,
        streamItemIds: [item.id],
        ...(targetType ? { targetType, targetId } : {}),
        draft: {
          ...(disposition === 'promote_task' || (disposition === 'merge_task' && !targetId)
            ? { title: item.rawText.trim().split('\n')[0]?.slice(0, 200) || 'Untitled' }
            : {}),
          ...(disposition === 'merge_task' ? { asSubtask: true, title: item.rawText.trim().split('\n')[0]?.slice(0, 200) } : {}),
          ...(o.energy !== undefined ? { energy: o.energy } : {}),
          ...(o.effort !== undefined ? { effort: o.effort } : {}),
          ...(o.areaId !== undefined ? { areaId: o.areaId } : {}),
        },
      });
    },
    [decide, overrides],
  );

  // Accept-all only when EVERY proposal is low-risk.
  const allLowRisk =
    proposalList.length > 1 &&
    proposalList.every((d) => LOW_RISK_DISPOSITIONS.includes(d.disposition));

  const handleAcceptAll = useCallback(() => {
    for (const d of proposalList) accept.mutate(d.id);
  }, [accept, proposalList]);

  const handleClose = useCallback(() => {
    setOverrides({});
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="right" className="w-full data-[side=right]:sm:max-w-[640px] flex flex-col">
        <SheetHeader>
          <SheetTitle className="text-[13px]">Needs your call</SheetTitle>
          <SheetDescription className="text-[10px]">
            {proposalList.length > 0
              ? 'Suggestions wait for you. Nothing here has changed anything yet.'
              : pending.length > 0
                ? 'Nothing suggested right now. These captures are still waiting.'
                : 'Nothing needs you.'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 -mx-0 space-y-4">
          {proposalList.length === 0 && pending.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
              <Inbox size={20} className="opacity-30" />
              <p className="text-[11px]">Nothing needs you.</p>
            </div>
          )}

          {proposalList.length > 0 && (
            <div className="space-y-2">
              {allLowRisk && (
                <div className="flex justify-end">
                  <button
                    onClick={handleAcceptAll}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-semibold text-primary hover:bg-primary/5 transition-colors"
                  >
                    <Check size={10} />
                    Accept all
                  </button>
                </div>
              )}
              {groupByPass(proposalList).map((group, i) => (
                <div key={group.passId ?? `manual-${i}`} className="space-y-2">
                  {groupByPass(proposalList).length > 1 && (
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-1 pt-1">
                      {group.passId ? `Suggested ${timeAgo(group.decisions[0].createdAt)}` : 'Suggested in chat'}
                    </p>
                  )}
                  {group.decisions.map((d) => (
                    <ProposalCard key={d.id} decision={d} />
                  ))}
                </div>
              ))}
            </div>
          )}

          {pending.length > 0 && (
            <div>
              {proposalList.length > 0 && (
                <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1 px-2">
                  Still waiting
                </p>
              )}
              <div className="space-y-0.5">
                {pending.map((item) => (
                  <ManualRow
                    key={item.id}
                    item={item}
                    overrides={overrides[item.id] ?? {}}
                    onUpdateOverride={(field, value) => updateOverride(item.id, field, value)}
                    onDecide={(disposition) => handleManualDecide(item, disposition)}
                    onMergeTask={(taskId) => handleManualDecide(item, 'merge_task', 'task', taskId)}
                    onMergeNote={(noteId) => handleManualDecide(item, 'merge_note', 'note', noteId)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

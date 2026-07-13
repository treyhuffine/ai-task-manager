"use client";

/**
 * The stream tab: a calm ledger of captures, not a work queue (spec §3.12).
 *
 * - Default view is Recent. "Needs your call" appears only when non-empty.
 *   Power filters (per-status history) live behind a small dropdown.
 * - No unprocessed-count badges anywhere — the ambient signal is binary.
 * - Raw text is immutable: no editing affordance. Corrections happen on the
 *   derived task/note.
 * - Every row shows its consequences ("Became a task", "Added to …") with
 *   tap-through, and undo/reopen where applicable.
 */

import { useState, useCallback } from 'react';
import {
  Loader2, Mic, MessageSquare, Inbox, ListFilter, Archive, BookOpen,
  RotateCcw, RefreshCw, Sparkles, Target, FileText, Clock, ChevronDown,
} from 'lucide-react';
import {
  useStream,
  useProposedDecisions,
  useTriageDecide,
  useReopenStream,
  useRetryStream,
  useStartTriageSweep,
} from '@/hooks/use-stream';
import { useDashboard } from '@/contexts/dashboard-context';
import { cn } from '@/lib/utils';
import { StreamTriage } from './stream-triage';
import { StreamDigest } from './stream-digest';
import { TaskActions, NoteActions } from './promote-actions';
import { StreamAttachments } from './stream-attachments';
import {
  Popover, PopoverTrigger, PopoverContent,
} from '@/components/ui/popover';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import type { StreamRecordWithOutcomes, StreamStatus } from '@/db/types';

const SOURCE_ICONS: Record<string, typeof Mic> = {
  capture: Inbox,
  chat: MessageSquare,
  webhook: Inbox,
};

/** Calm vocabulary (spec §1.10). Internal status names never render. */
const STATUS_LABELS: Record<StreamStatus, string> = {
  pending: 'Captured',
  proposed: 'Needs your call',
  promoted: '',
  reviewed: 'Kept as a thought',
  dismissed: 'Set aside',
  incubating: 'Kept for later',
};

const STATUS_COLORS: Record<StreamStatus, string> = {
  pending: 'bg-amber-500',
  proposed: 'bg-primary',
  promoted: 'bg-emerald-500',
  reviewed: 'bg-violet-400',
  dismissed: 'bg-muted-foreground',
  incubating: 'bg-sky-400',
};

type ViewFilter = 'recent' | 'needs_call' | StreamStatus;

const HISTORY_FILTERS: Array<{ id: ViewFilter; label: string }> = [
  { id: 'pending', label: 'Captured' },
  { id: 'promoted', label: 'Added' },
  { id: 'reviewed', label: 'Kept as thoughts' },
  { id: 'incubating', label: 'Kept for later' },
  { id: 'dismissed', label: 'Set aside' },
];

function isPreprocessingPlaceholder(item: StreamRecordWithOutcomes): boolean {
  const head = item.rawText.trimStart();
  return (
    head.startsWith('[Voice memo, transcription failed]') ||
    head.startsWith('[Voice memo, pending transcription]') ||
    head.startsWith('[Images, extraction pending]')
  );
}

export function StreamList() {
  const { theme, openTask, openNote } = useDashboard();
  const isDark = theme === 'dark';

  const [view, setView] = useState<ViewFilter>('recent');
  const [triageOpen, setTriageOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const filter = view === 'recent' || view === 'needs_call'
    ? {}
    : { status: view as StreamStatus };
  const { data: items, isLoading, error } = useStream(filter);
  const { data: proposals } = useProposedDecisions();
  const proposalCount = proposals?.length ?? 0;

  const decide = useTriageDecide();
  const reopen = useReopenStream();
  const retry = useRetryStream();
  const sweep = useStartTriageSweep();

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(null), 5000);
  }, []);

  const handleSweep = useCallback(() => {
    sweep.mutate(undefined, {
      onSuccess: (result) => {
        if (result.started) showNotice('Working on it. The digest will appear here when done.');
        else if (result.reason === 'empty') showNotice('Nothing waiting to triage.');
        else if (result.reason === 'already_running') showNotice('A triage pass is already running.');
        else showNotice('Could not start triage right now.');
      },
      onError: () => showNotice('Could not start triage right now.'),
    });
  }, [sweep, showNotice]);

  const handleReopen = useCallback((id: string) => {
    reopen.mutate(id, {
      onError: (err) => showNotice(err instanceof Error ? err.message : 'Could not reopen this capture.'),
    });
  }, [reopen, showNotice]);

  const visibleItems = (items ?? []).filter((item) => {
    if (view === 'needs_call') return item.status === 'proposed';
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className={cn(
        'px-3 py-2 border-b border-border flex items-center gap-2 flex-shrink-0',
        isDark ? 'bg-card/50' : 'bg-muted'
      )}>
        <div className="flex items-center gap-0.5 p-0.5 bg-card rounded border border-border">
          <button
            onClick={() => setView('recent')}
            className={cn(
              'px-2 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider transition-all',
              view === 'recent' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Recent
          </button>
          {proposalCount > 0 && (
            <button
              onClick={() => setView('needs_call')}
              className={cn(
                'px-2 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider transition-all',
                view === 'needs_call' ? 'bg-primary text-primary-foreground' : 'text-primary hover:text-primary/80',
              )}
            >
              Needs your call
            </button>
          )}
        </div>

        {/* Power filters: full history, tucked away */}
        <Popover>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-1 px-1.5 py-1 rounded text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors" title="History">
              <ListFilter size={11} />
              <ChevronDown size={8} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-44 p-0" sideOffset={4}>
            <div className="py-1">
              {HISTORY_FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setView(f.id)}
                  className={cn(
                    'w-full text-left px-3 py-1.5 text-[10.5px] hover:bg-muted transition-colors',
                    view === f.id ? 'text-primary font-semibold' : 'text-foreground',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <div className="flex-1" />

        {notice && (
          <span className="text-[9.5px] text-muted-foreground truncate max-w-[45%]">{notice}</span>
        )}

        {proposalCount > 0 && (
          <button
            onClick={() => setTriageOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[9px] font-bold text-primary hover:bg-primary/5 rounded-md transition-colors"
          >
            Review
          </button>
        )}
        <button
          onClick={handleSweep}
          disabled={sweep.isPending}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[9px] font-bold text-primary hover:bg-primary/5 rounded-md transition-colors disabled:opacity-50"
          title="Have the assistant triage waiting captures"
        >
          <Sparkles size={10} />
          Triage
        </button>
      </div>

      {/* Review slide-over (proposals + manual) */}
      <StreamTriage open={triageOpen} onOpenChange={setTriageOpen} />

      <div className="flex-1 overflow-y-auto pb-4">
        {/* Digest: what triage did, graduation offers */}
        {view === 'recent' && <StreamDigest />}

        <div className="p-4">
          {isLoading && (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center h-32 text-destructive text-[11px]">
              Failed to load stream
            </div>
          )}
          {visibleItems.length === 0 && !isLoading && !error && (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
              <Inbox size={20} className="opacity-30" />
              <p className="text-[11px]">
                {view === 'needs_call' ? 'Nothing needs you.' : 'Nothing here yet. Capture anything.'}
              </p>
            </div>
          )}

          {visibleItems.length > 0 && (
            <div className="space-y-3 relative px-2 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-border">
              {visibleItems.map((item) => (
                <StreamRow
                  key={item.id}
                  item={item}
                  onOpenEntity={(type, id) => (type === 'task' ? openTask(id) : openNote(id))}
                  onKeepAsThought={() => decide.mutate({ disposition: 'journal', streamItemIds: [item.id] })}
                  onDismiss={() => decide.mutate({ disposition: 'dismiss', streamItemIds: [item.id] })}
                  onPromoteTask={() => decide.mutate({
                    disposition: 'promote_task',
                    streamItemIds: [item.id],
                    draft: { title: item.rawText.trim().split('\n')[0]?.slice(0, 200) || 'Untitled', body: item.rawText },
                  })}
                  onPromoteNote={() => decide.mutate({ disposition: 'promote_note', streamItemIds: [item.id] })}
                  onMergeTask={(taskId) => decide.mutate({
                    disposition: 'merge_task',
                    streamItemIds: [item.id],
                    targetType: 'task',
                    targetId: taskId,
                    draft: { asSubtask: true, title: item.rawText.trim().split('\n')[0]?.slice(0, 200) },
                  })}
                  onMergeNote={(noteId) => decide.mutate({
                    disposition: 'merge_note',
                    streamItemIds: [item.id],
                    targetType: 'note',
                    targetId: noteId,
                  })}
                  onReopen={() => handleReopen(item.id)}
                  onRetry={() => retry.mutate(item.id, {
                    onError: () => showNotice('Still not able to read it. The original is safe, try again later.'),
                  })}
                  onReview={() => setTriageOpen(true)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StreamRow({
  item,
  onOpenEntity,
  onKeepAsThought,
  onDismiss,
  onPromoteTask,
  onPromoteNote,
  onMergeTask,
  onMergeNote,
  onReopen,
  onRetry,
  onReview,
}: {
  item: StreamRecordWithOutcomes;
  onOpenEntity: (type: 'task' | 'note', id: string) => void;
  onKeepAsThought: () => void;
  onDismiss: () => void;
  onPromoteTask: () => void;
  onPromoteNote: () => void;
  onMergeTask: (taskId: string) => void;
  onMergeNote: (noteId: string) => void;
  onReopen: () => void;
  onRetry: () => void;
  onReview: () => void;
}) {
  const SourceIcon = item.media === 'voice' ? Mic : (SOURCE_ICONS[item.source] ?? Inbox);
  const isPending = item.status === 'pending';
  const isProposed = item.status === 'proposed';
  const isSettled = item.status === 'promoted' || item.status === 'reviewed' || item.status === 'dismissed' || item.status === 'incubating';
  const needsRetry = isPending && isPreprocessingPlaceholder(item);
  const label = STATUS_LABELS[item.status];

  return (
    <div className="pl-6 relative group">
      <div className={cn(
        'absolute left-[5px] top-1.5 w-2 h-2 rounded-full z-10 ring-2 ring-background',
        STATUS_COLORS[item.status] ?? 'bg-muted-foreground',
        item.status === 'promoted' && 'opacity-40',
      )} />

      <div className={cn('flex items-start gap-2', item.status === 'promoted' && 'opacity-60', item.status === 'dismissed' && 'opacity-40')}>
        <div className="flex-1 min-w-0">
          <p className={cn(
            'text-[11.5px] leading-snug',
            isPending || isProposed ? 'text-foreground' : 'text-muted-foreground',
          )}>
            {item.rawText}
          </p>
          <StreamAttachments attachments={item.attachments} />

          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <SourceIcon size={9} className="text-muted-foreground/50" />
            <p className="text-[8.5px] text-muted-foreground font-mono uppercase">
              {new Date(item.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </p>

            {needsRetry && (
              <span className="text-[8.5px] text-muted-foreground">
                Your recording is saved. Reading it needs another try.
              </span>
            )}

            {isProposed && (
              <button onClick={onReview} className="text-[8.5px] font-bold text-primary hover:underline">
                {STATUS_LABELS.proposed}
              </button>
            )}

            {label && !isProposed && item.status !== 'pending' && (
              <span className="text-[8.5px] text-muted-foreground font-medium">{label}</span>
            )}

            {/* Consequences: where this capture went. */}
            {item.outcomes.map((o) => (
              <button
                key={`${o.entityType}:${o.entityId}:${o.relation}`}
                onClick={() => onOpenEntity(o.entityType, o.entityId)}
                className="inline-flex items-center gap-1 text-[8.5px] font-semibold text-emerald-600 dark:text-emerald-500 hover:underline"
                title={o.relation === 'created' ? 'Created from this capture' : 'This capture was added to it'}
              >
                {o.entityType === 'task' ? <Target size={8} /> : <FileText size={8} />}
                {o.relation === 'merged_into' ? 'Added to ' : ''}
                {o.entityTitle ?? o.entityType}
              </button>
            ))}

            {item.status === 'incubating' && item.resurfaceAt && (
              <span className="inline-flex items-center gap-1 text-[8.5px] text-sky-500">
                <Clock size={8} />
                back {new Date(item.resurfaceAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>

        {/* Row actions */}
        <TooltipProvider>
          <div className="flex items-center gap-0.5 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex-shrink-0">
            {needsRetry && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={onRetry} className="p-1.5 rounded-md text-primary hover:bg-primary/10 transition-colors">
                    <RefreshCw size={12} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Try reading it again</TooltipContent>
              </Tooltip>
            )}
            {isPending && !needsRetry && (
              <>
                <TaskActions onPromote={onPromoteTask} onMerge={onMergeTask} />
                <NoteActions onPromote={onPromoteNote} onMerge={onMergeNote} />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button onClick={onKeepAsThought} className="p-1.5 rounded-md text-muted-foreground hover:text-violet-500 hover:bg-muted transition-colors">
                      <BookOpen size={12} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Keep as a thought</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button onClick={onDismiss} className="p-1.5 rounded-md text-muted-foreground hover:text-muted-foreground/80 hover:bg-muted transition-colors">
                      <Archive size={12} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Set aside</TooltipContent>
                </Tooltip>
              </>
            )}
            {isSettled && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={onReopen} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                    <RotateCcw size={12} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Bring it back</TooltipContent>
              </Tooltip>
            )}
          </div>
        </TooltipProvider>
      </div>
    </div>
  );
}

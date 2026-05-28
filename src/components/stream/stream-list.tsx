"use client";

import { useState, useCallback, useRef } from 'react';
import {
  X, Loader2, Mic, MessageSquare, Inbox, Pencil, Check, ListFilter, Archive,
} from 'lucide-react';
import { useStream, useDismissStream, useUpdateStream } from '@/hooks/use-stream';
import { useCreateTask } from '@/hooks/use-tasks';
import { useCreateNote, useUpdateNote } from '@/hooks/use-notes';
import { useDashboard } from '@/contexts/dashboard-context';
import { cn } from '@/lib/utils';
import { StreamTriage } from './stream-triage';
import { TaskActions, NoteActions } from './promote-actions';
import { StreamAttachments } from './stream-attachments';
import type { StreamRecord, StreamStatus } from '@/db/types';

const SOURCE_ICONS: Record<string, typeof Mic> = {
  capture: Inbox,
  chat: MessageSquare,
  webhook: Inbox,
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-500',
  promoted: 'bg-emerald-500',
  dismissed: 'bg-muted-foreground',
};

function StreamItemText({ item, onSave }: { item: StreamRecord; onSave: (id: string, text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(item.rawText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSave = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== item.rawText) {
      onSave(item.id, trimmed);
    } else {
      setEditValue(item.rawText);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
        <textarea
          ref={textareaRef}
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          className="w-full text-[11.5px] leading-snug bg-background border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-primary resize-none"
          rows={Math.min(editValue.split('\n').length + 1, 5)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave(); }
            if (e.key === 'Escape') { setEditValue(item.rawText); setEditing(false); }
          }}
        />
        <div className="flex gap-1 mt-0.5">
          <button onClick={handleSave} className="text-[9px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground hover:bg-primary/90">
            <Check size={8} />
          </button>
          <button onClick={() => { setEditValue(item.rawText); setEditing(false); }} className="text-[9px] px-1.5 py-0.5 rounded text-muted-foreground hover:bg-muted">
            <X size={8} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <p
      className={cn(
        'text-[11.5px] leading-snug cursor-text',
        item.status === 'promoted' ? 'text-muted-foreground' : 'text-foreground',
      )}
      onDoubleClick={() => { if (item.status === 'pending') setEditing(true); }}
      title={item.status === 'pending' ? 'Double-click to edit' : undefined}
    >
      {item.rawText}
    </p>
  );
}

export function StreamList() {
  const { theme } = useDashboard();
  const isDark = theme === 'dark';

  const [statusFilter, setStatusFilter] = useState<StreamStatus | 'all'>('all');
  const [triageOpen, setTriageOpen] = useState(false);

  // Get pending count for the triage button
  const { data: pendingItems } = useStream({ status: 'pending' });
  const pendingCount = pendingItems?.length ?? 0;

  const filter = {
    ...(statusFilter !== 'all' ? { status: statusFilter as StreamStatus } : {}),
  };

  const { data: items, isLoading, error } = useStream(filter);
  const dismissStream = useDismissStream();
  const updateStream = useUpdateStream();
  const createTask = useCreateTask();
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();

  const handleDismiss = useCallback((id: string) => {
    dismissStream.mutate(id);
  }, [dismissStream]);

  const handlePromoteToTask = useCallback((item: StreamRecord) => {
    createTask.mutate({
      rawInput: item.rawText,
      title: item.rawText.slice(0, 200),
      body: item.rawText,
      attachments: item.attachments ?? [],
    }, {
      onSuccess: (task) => {
        updateStream.mutate({
          id: item.id,
          status: 'promoted',
          promotedToType: 'task',
          promotedToId: task.id,
          promotedAt: new Date().toISOString(),
        } as Parameters<typeof updateStream.mutate>[0]);
      },
    });
  }, [createTask, updateStream]);

  const handleEditText = useCallback((id: string, text: string) => {
    updateStream.mutate({
      id,
      rawText: text,
    } as Parameters<typeof updateStream.mutate>[0]);
  }, [updateStream]);

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
      },
    });
  }, [createNote, updateStream]);

  const handleMergeIntoTask = useCallback((item: StreamRecord, targetTaskId: string) => {
    // Create as subtask of the target task
    createTask.mutate({
      rawInput: item.rawText,
      title: item.rawText.slice(0, 200),
      body: item.rawText,
      parentId: targetTaskId,
      attachments: item.attachments ?? [],
    }, {
      onSuccess: (task) => {
        updateStream.mutate({
          id: item.id,
          status: 'promoted',
          promotedToType: 'task',
          promotedToId: task.id,
          promotedAt: new Date().toISOString(),
        } as Parameters<typeof updateStream.mutate>[0]);
      },
    });
  }, [createTask, updateStream]);

  const handleMergeIntoNote = useCallback((item: StreamRecord, targetNoteId: string) => {
    // Append text to existing note
    updateNote.mutate({
      id: targetNoteId,
      body: item.rawText, // API should append, but for now we mark as promoted
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
      },
    });
  }, [updateNote, updateStream]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className={cn(
        'px-3 py-2 border-b border-border flex items-center gap-2 flex-shrink-0',
        isDark ? 'bg-card/50' : 'bg-muted'
      )}>
        <div className="flex items-center gap-0.5 p-0.5 bg-card rounded border border-border">
          {(['all', 'pending', 'promoted'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'px-2 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider transition-all',
                statusFilter === s
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="text-[8.5px] font-bold text-muted-foreground uppercase tracking-widest">
          {items ? `${items.length} items` : 'Loading...'}
        </span>
        <div className="flex-1" />
        {pendingCount > 0 && (
          <button
            onClick={() => setTriageOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[9px] font-bold text-primary hover:bg-primary/5 rounded-md transition-colors"
          >
            <ListFilter size={10} />
            Triage ({pendingCount})
          </button>
        )}
      </div>

      {/* Triage slide-over */}
      <StreamTriage open={triageOpen} onOpenChange={setTriageOpen} />

      {/* Stream items */}
      <div className="flex-1 overflow-y-auto p-4">
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
        {items && items.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
            <Inbox size={20} className="opacity-30" />
            <p className="text-[11px]">
              {statusFilter === 'pending' ? 'No pending captures' : 'No stream items'}
            </p>
          </div>
        )}
        {items && items.length > 0 && (
          <div className="space-y-3 relative px-2 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-border">
            {items.map((item) => {
              const SourceIcon = item.media === 'voice' ? Mic : (SOURCE_ICONS[item.source] ?? Inbox);
              const isPending = item.status === 'pending';
              const isPromoted = item.status === 'promoted';

              return (
                <div key={item.id} className="pl-6 relative group">
                  <div className={cn(
                    'absolute left-[5px] top-1.5 w-2 h-2 rounded-full z-10 ring-2 ring-background',
                    STATUS_COLORS[item.status] ?? 'bg-muted-foreground',
                    isPromoted && 'opacity-40',
                  )} />

                  <div className={cn(
                    'flex items-start gap-2',
                    isPromoted && 'opacity-50',
                  )}>
                    <div className="flex-1 min-w-0">
                      <StreamItemText item={item} onSave={handleEditText} />
                      <StreamAttachments attachments={item.attachments} />
                      <div className="flex items-center gap-2 mt-0.5">
                        <SourceIcon size={9} className="text-muted-foreground/50" />
                        <p className="text-[8.5px] text-muted-foreground font-mono uppercase">
                          {new Date(item.createdAt).toLocaleTimeString('en-US', {
                            hour: 'numeric', minute: '2-digit',
                          })}
                        </p>
                        {isPromoted && item.promotedToType && (
                          <span className="text-[8.5px] text-emerald-500 font-bold">
                            {'\u2192'} {item.promotedToType}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions (pending only) — always visible on mobile, hover on desktop */}
                    {isPending && (
                      <div className="flex items-center gap-0.5 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <TaskActions
                          onPromote={() => handlePromoteToTask(item)}
                          onMerge={(taskId) => handleMergeIntoTask(item, taskId)}
                        />
                        <NoteActions
                          onPromote={() => handlePromoteToNote(item)}
                          onMerge={(noteId) => handleMergeIntoNote(item, noteId)}
                        />
                        <button
                          onClick={() => handleDismiss(item.id)}
                          className="p-1.5 text-muted-foreground hover:text-muted-foreground/80 hover:bg-muted rounded-md transition-colors"
                          title="Archive"
                        >
                          <Archive size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

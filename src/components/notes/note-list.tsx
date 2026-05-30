"use client";

import { useState, useCallback, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FileText, Filter, ArrowDownAz, Loader2, Search } from 'lucide-react';
import { useNotes, useUpdateNote } from '@/hooks/use-notes';
import { useAreas } from '@/hooks/use-areas';
import { useDashboard } from '@/contexts/dashboard-context';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { NoteRow } from './note-row';
import { cn } from '@/lib/utils';
import type { NoteStatus, NoteRecord } from '@/db/types';

export function NoteList() {
  const { theme, openNote } = useDashboard();
  const isDark = theme === 'dark';

  const [statusFilter, setStatusFilter] = useState<NoteStatus | 'all'>('active');
  const [areaFilter, setAreaFilter] = useState<string | 'all'>('all');
  const [sortBy, setSortBy] = useState<'lastViewedAt' | 'createdAt' | 'updatedAt'>('lastViewedAt');
  // Decisions-only filter — agent-written notes with title prefix
  // "Decision: ". See docs/async-agents-v1.md §4.5.
  const [decisionsOnly, setDecisionsOnly] = useState(false);

  const filter = {
    ...(statusFilter !== 'all' ? { status: statusFilter as NoteStatus } : {}),
    ...(areaFilter !== 'all' ? { areaId: areaFilter } : {}),
    ...(decisionsOnly ? { decisionsOnly: true } : {}),
    orderBy: sortBy,
  };

  const { data: notes, isLoading, error } = useNotes(filter);
  const { data: areas } = useAreas();
  const updateNote = useUpdateNote();

  const handleUpdate = useCallback((id: string, field: string, value: unknown) => {
    updateNote.mutate({ id, [field]: value } as Parameters<typeof updateNote.mutate>[0]);
  }, [updateNote]);

  const handleArchive = useCallback((id: string) => {
    updateNote.mutate({ id, status: 'archived' } as Parameters<typeof updateNote.mutate>[0]);
  }, [updateNote]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className={cn(
        'px-3 py-2 border-b border-border flex items-center gap-2 flex-shrink-0',
        isDark ? 'bg-card/50' : 'bg-muted'
      )}>
        {/* Status filter */}
        <div className="flex items-center gap-0.5 p-0.5 bg-card rounded border border-border">
          {(['active', 'archived', 'all'] as const).map((s) => (
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

        {/* Area filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1.5 text-muted-foreground hover:text-foreground bg-card rounded border border-border">
              <Filter size={11} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuLabel className="text-[9px] uppercase tracking-widest">Area</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={areaFilter} onValueChange={setAreaFilter}>
              <DropdownMenuRadioItem value="all" className="text-xs">All areas</DropdownMenuRadioItem>
              <DropdownMenuSeparator />
              {areas?.map(area => (
                <DropdownMenuRadioItem key={area.id} value={area.id} className="text-xs">
                  {area.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Sort */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1.5 text-muted-foreground hover:text-foreground bg-card rounded border border-border">
              <ArrowDownAz size={11} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40">
            <DropdownMenuLabel className="text-[9px] uppercase tracking-widest">Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <DropdownMenuRadioItem value="lastViewedAt" className="text-xs">Last viewed</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="createdAt" className="text-xs">Created</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="updatedAt" className="text-xs">Updated</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Decisions filter — agent-written notes with "Decision: " prefix */}
        <button
          onClick={() => setDecisionsOnly((v) => !v)}
          title={decisionsOnly ? 'Show all notes' : 'Show decisions only'}
          className={cn(
            'px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-wider rounded border transition-all',
            decisionsOnly
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-card text-muted-foreground hover:text-foreground',
          )}
        >
          Decisions
        </button>

        <div className="flex-1" />
        <button
          onClick={() => document.dispatchEvent(new CustomEvent('open-search', { detail: { initialQuery: 'note: ' } }))}
          className="p-1.5 text-muted-foreground hover:text-foreground bg-card rounded border border-border"
          title="Search notes"
        >
          <Search size={11} />
        </button>
      </div>

      {/* Note list */}
      <VirtualNoteList
        notes={notes}
        isLoading={isLoading}
        error={error}
        onUpdate={handleUpdate}
        onArchive={handleArchive}
        onOpen={openNote}
      />
    </div>
  );
}

/* ── Virtualized inner list ── */

interface VirtualNoteListProps {
  notes: NoteRecord[] | undefined;
  isLoading: boolean;
  error: Error | null;
  onUpdate: (id: string, field: string, value: unknown) => void;
  onArchive: (id: string) => void;
  onOpen: (id: string) => void;
}

function VirtualNoteList({
  notes, isLoading, error, onUpdate, onArchive, onOpen,
}: VirtualNoteListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: notes?.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 68,
    overscan: 10,
    getItemKey: (index) => notes?.[index]?.id ?? index,
  });

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-2">
      {isLoading && (
        <div className="flex items-center justify-center h-32 text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
        </div>
      )}
      {error && (
        <div className="flex items-center justify-center h-32 text-destructive text-[11px]">
          Failed to load notes
        </div>
      )}
      {notes && notes.length === 0 && (
        <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
          <FileText size={20} className="opacity-30" />
          <p className="text-[11px]">No notes found</p>
        </div>
      )}
      {notes && notes.length > 0 && (
        <div
          style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const note = notes[virtualRow.index];
            return (
              <div
                key={note.id}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <NoteRow
                  note={note}
                  onUpdate={onUpdate}
                  onArchive={onArchive}
                  onOpen={onOpen}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

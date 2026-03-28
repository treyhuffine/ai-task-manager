"use client";

import { useState, useCallback } from 'react';
import { FileText, Filter, Loader2 } from 'lucide-react';
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
import type { NoteStatus } from '@/db/types';

export function NoteList() {
  const { theme, openNote } = useDashboard();
  const isDark = theme === 'dark';

  const [statusFilter, setStatusFilter] = useState<NoteStatus | 'all'>('active');
  const [areaFilter, setAreaFilter] = useState<string | 'all'>('all');

  const filter = {
    ...(statusFilter !== 'all' ? { status: statusFilter as NoteStatus } : {}),
    ...(areaFilter !== 'all' ? { area_id: areaFilter } : {}),
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

        <div className="flex-1" />
      </div>

      {/* Note list */}
      <div className="flex-1 overflow-y-auto p-2">
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
          <div className="space-y-0.5">
            {notes.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                onUpdate={handleUpdate}
                onArchive={handleArchive}
                onOpen={openNote}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

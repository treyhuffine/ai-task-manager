"use client";

import { useState, useCallback, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FileText, Filter, ArrowDownAz, Loader2 } from 'lucide-react';
import { useNotes, useUpdateNote } from '@/hooks/use-notes';
import { useAreas } from '@/hooks/use-areas';
import { useDashboard } from '@/contexts/dashboard-context';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  ListToolbar,
  SegmentedTabs,
  ToolbarActiveDot,
  ToolbarSearchButton,
  toolbarButtonClass,
} from '@/components/shared/list-toolbar';
import { NoteRow } from './note-row';
import type { NoteStatus } from '@/db/types';
import type { NoteListDTO } from '@/lib/api/dto/entity-list';

type NoteSortOption = 'lastViewedAt' | 'createdAt' | 'updatedAt';

const NOTE_SORT_LABELS: Record<NoteSortOption, string> = {
  lastViewedAt: 'Last viewed',
  createdAt: 'Created',
  updatedAt: 'Updated',
};

const NOTE_STATUS_TABS = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
] as const;

export function NoteList() {
  const { openNote } = useDashboard();

  const [statusFilter, setStatusFilter] = useState<NoteStatus | 'all'>('active');
  const [areaFilter, setAreaFilter] = useState<string | 'all'>('all');
  const [sortBy, setSortBy] = useState<NoteSortOption>('lastViewedAt');
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

  const areaLabel =
    areaFilter === 'all'
      ? 'All Areas'
      : areas?.find((a) => a.id === areaFilter)?.name ?? 'All Areas';

  const handleUpdate = useCallback((id: string, field: string, value: unknown) => {
    updateNote.mutate({ id, [field]: value } as Parameters<typeof updateNote.mutate>[0]);
  }, [updateNote]);

  const handleArchive = useCallback((id: string) => {
    updateNote.mutate({ id, status: 'archived' } as Parameters<typeof updateNote.mutate>[0]);
  }, [updateNote]);

  const filterActive = areaFilter !== 'all' || decisionsOnly;
  const filterSummary = areaFilter !== 'all' ? areaLabel : decisionsOnly ? 'Decisions' : 'Filter';

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <ListToolbar>
        {/* Status — primary segmented filter */}
        <SegmentedTabs<NoteStatus | 'all'>
          ariaLabel="Note status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={NOTE_STATUS_TABS}
        />

        {/* Filter — Decisions + Area */}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={filterActive ? `Filter, active: ${filterSummary}` : 'Filter notes'}
            className={toolbarButtonClass({ active: filterActive })}
          >
            <Filter className="size-3.5 shrink-0" />
            <span className="hidden @sm/lt:inline max-w-[120px] truncate">
              {filterActive ? filterSummary : 'Filter'}
            </span>
            {filterActive && <ToolbarActiveDot />}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {/* Decisions-only — agent-written notes with "Decision: " prefix */}
            <DropdownMenuCheckboxItem
              checked={decisionsOnly}
              onCheckedChange={(c) => setDecisionsOnly(!!c)}
              className="text-xs"
            >
              Decisions only
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[9px] uppercase tracking-widest">Area</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={areaFilter} onValueChange={setAreaFilter}>
              <DropdownMenuRadioItem value="all" className="text-xs">All Areas</DropdownMenuRadioItem>
              {areas?.map(area => (
                <DropdownMenuRadioItem key={area.id} value={area.id} className="text-xs">
                  {area.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Sort — icon plus the active sort's name when there's room */}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Sort by ${NOTE_SORT_LABELS[sortBy]}`}
            className={toolbarButtonClass()}
          >
            <ArrowDownAz className="size-3.5 shrink-0" />
            <span className="hidden @md/lt:inline">{NOTE_SORT_LABELS[sortBy]}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40">
            <DropdownMenuLabel className="text-[9px] uppercase tracking-widest">Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sortBy} onValueChange={(v) => setSortBy(v as NoteSortOption)}>
              <DropdownMenuRadioItem value="lastViewedAt" className="text-xs">Last viewed</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="createdAt" className="text-xs">Created</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="updatedAt" className="text-xs">Updated</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <ToolbarSearchButton
          label="Search notes"
          onClick={() => document.dispatchEvent(new CustomEvent('open-search', { detail: { initialQuery: 'note: ' } }))}
        />
      </ListToolbar>

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
  notes: NoteListDTO[] | undefined;
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

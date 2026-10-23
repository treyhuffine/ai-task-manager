"use client";

import { useState, useCallback, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FileText, Filter, ArrowDownAz, Gavel, Loader2, Plus } from 'lucide-react';
import { useCreateNote, useNotes, useUpdateNote } from '@/hooks/use-notes';
import { useAreas } from '@/hooks/use-areas';

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
import { Tip } from '@/components/ui/tip';
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

export function NoteList({ onOpenNote: openNote, privatePlanning = true, areaFilter: controlledArea, onAreaFilterChange, onSearch, decisionsOnly: controlledDecisions, onDecisionsChange }: { onOpenNote: (id: string) => void; privatePlanning?: boolean; areaFilter?: string; onAreaFilterChange?: (value: string) => void; onSearch?: () => void; decisionsOnly?: boolean; onDecisionsChange?: (value: boolean) => void }) {

  const [statusFilter, setStatusFilter] = useState<NoteStatus | 'all'>('active');
  const [ownAreaFilter, setOwnAreaFilter] = useState('all');
  const areaFilter = controlledArea ?? ownAreaFilter;
  const setAreaFilter = onAreaFilterChange ?? setOwnAreaFilter;
  const [sortBy, setSortBy] = useState<NoteSortOption>('lastViewedAt');
  // Decisions are notes marked as one (docs/homes-spec.md §9.7), never a
  // title convention.
  const [ownDecisions, setOwnDecisions] = useState(false);
  const decisionsOnly = controlledDecisions ?? ownDecisions;
  const setDecisionsOnly = onDecisionsChange ?? setOwnDecisions;

  const filter = {
    ...(statusFilter !== 'all' ? { status: statusFilter as NoteStatus } : {}),
    ...(areaFilter !== 'all' ? { areaId: areaFilter } : {}),
    ...(decisionsOnly ? { kind: 'decision' as const } : {}),
    orderBy: sortBy,
  };

  const { data: notes, isLoading, error } = useNotes(filter);
  const { data: areas } = useAreas();
  const updateNote = useUpdateNote();
  const createNote = useCreateNote();

  // New makes what the list is showing: a decision while Decisions is on.
  const newLabel = decisionsOnly ? 'New decision' : 'New note';
  const handleNew = useCallback(() => {
    createNote.mutate(
      {
        body: ' ',
        ...(decisionsOnly ? { kind: 'decision' as const } : {}),
        ...(areaFilter !== 'all' ? { areaId: areaFilter } : {}),
      },
      { onSuccess: (note) => openNote(note.id) },
    );
  }, [createNote, decisionsOnly, areaFilter, openNote]);

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
            {/* Notes marked as decisions */}
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

        {/* Folds to its icon before the status tabs have to scroll. */}
        <Tip label={newLabel} onlyWhenTextHidden>
          <button
            type="button"
            onClick={handleNew}
            disabled={createNote.isPending}
            aria-label={newLabel}
            className={toolbarButtonClass()}
          >
            {decisionsOnly ? <Gavel className="size-3.5 shrink-0" /> : <Plus className="size-3.5 shrink-0" />}
            <span className="hidden @2xl/lt:inline">{newLabel}</span>
          </button>
        </Tip>

        <ToolbarSearchButton
          label={decisionsOnly ? 'Search decisions' : 'Search notes'}
          onClick={onSearch ?? (() => document.dispatchEvent(new CustomEvent('open-search', { detail: { initialQuery: decisionsOnly ? 'decision: ' : 'note: ' } })))}
        />
      </ListToolbar>

      {/* Note list */}
      <VirtualNoteList
        notes={notes}
        privatePlanning={privatePlanning}
        isLoading={isLoading}
        error={error}
        onUpdate={handleUpdate}
        onArchive={handleArchive}
        onOpen={openNote}
        empty={decisionsOnly ? 'No decisions yet. Mark a note as a decision from its menu, or start a new one.' : 'No notes found'}
      />
    </div>
  );
}

/* ── Virtualized inner list ── */

interface VirtualNoteListProps {
  privatePlanning: boolean;
  notes: NoteListDTO[] | undefined;
  isLoading: boolean;
  error: { message: string } | null;
  onUpdate: (id: string, field: string, value: unknown) => void;
  onArchive: (id: string) => void;
  onOpen: (id: string) => void;
  empty: string;
}

function VirtualNoteList({
  notes, isLoading, error, onUpdate, onArchive, onOpen, empty, privatePlanning,
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
          <p className="max-w-[260px] text-center text-[11px]">{empty}</p>
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
                  privatePlanning={privatePlanning}
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

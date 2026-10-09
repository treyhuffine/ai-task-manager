'use client';

import { FileText, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { useAreas } from '@/hooks/use-areas';
import { useCreateNote, useNotes } from '@/hooks/use-notes';
import { ListToolbar, toolbarButtonClass } from '@/components/shared/list-toolbar';
import { cn } from '@/lib/utils';
import type { NoteListDTO } from '@/lib/api/dto/entity-list';
import { useTeamNav } from './team-context';

/** A note's title as a list shows it: its title, else its first line. */
function noteTitle(note: NoteListDTO): string {
  const title = note.title?.trim();
  if (title) return title;
  const first = (note.bodyExcerpt ?? '').split('\n').map((line) => line.replace(/^#+\s*/, '').trim()).find(Boolean);
  return first || 'Untitled note';
}

function when(iso: string): string {
  const date = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days < 1) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: 'short' });
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The team's shared notes, newest first, filtered by the rail's Area. */
export function TeamNotes() {
  const nav = useTeamNav();
  const notes = useNotes({ status: 'active', orderBy: 'updatedAt', ...(nav.areaId ? { areaId: nav.areaId } : {}) });
  const { data: areas } = useAreas();
  const areaName = useMemo(() => new Map((areas ?? []).map((a) => [a.id, a.name])), [areas]);
  const createNote = useCreateNote();
  const newNote = async () => {
    const note = await createNote.mutateAsync({ body: '', ...(nav.areaId ? { areaId: nav.areaId } : {}) });
    nav.openNote(note.id);
  };

  return (
    <div className="flex h-full flex-col">
      <ListToolbar>
        <span className="px-1 text-[12px] font-semibold">Notes</span>
        <div className="flex-1" />
        <button type="button" onClick={() => void newNote()} className={toolbarButtonClass()} aria-label="New note">
          <Plus className="size-3.5" />
          <span className="hidden @sm/lt:inline">New note</span>
        </button>
      </ListToolbar>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {notes.data && notes.data.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center text-sm text-muted-foreground">
            <FileText size={20} className="text-muted-foreground/60" />
            <p>No notes yet. Everyone in the team sees the notes added here.</p>
            <button type="button" onClick={() => void newNote()} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/50">
              New note
            </button>
          </div>
        )}
        <ul className="divide-y divide-border/60">
          {(notes.data ?? []).map((note) => (
            <li key={note.id}>
              <button
                type="button"
                onClick={() => nav.openNote(note.id)}
                className={cn(
                  'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40',
                  nav.noteId === note.id && 'bg-muted/50',
                )}
              >
                <FileText size={14} className="mt-0.5 flex-shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{noteTitle(note)}</span>
                  {note.bodyExcerpt && (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {(note.title ? note.bodyExcerpt : note.bodyExcerpt.split('\n').slice(1).join(' ')).replace(/[#*_`>]/g, '').trim()}
                    </span>
                  )}
                </span>
                <span className="flex flex-shrink-0 flex-col items-end gap-1 text-[10px] text-muted-foreground">
                  <span>{when(note.updatedAt)}</span>
                  {note.areaId && areaName.get(note.areaId) && <span className="rounded bg-muted px-1 py-0.5 uppercase tracking-wide">{areaName.get(note.areaId)}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

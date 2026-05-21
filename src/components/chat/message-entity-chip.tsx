'use client';

import { useState } from 'react';
import { CheckSquare, Square, StickyNote, Notebook } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EntityMarker } from '@/lib/entity-refs/parse-markers';

export interface EntityLookup {
  tasksById: Map<string, { id: string; title: string; status: string }>;
  notesById: Map<string, { id: string; title: string | null }>;
  /** Scratchpad lives on the session row — passed through so hover/click can preview. */
  scratchpad: string | null;
}

interface MessageEntityChipProps {
  marker: Exclude<EntityMarker, { kind: 'file' }>;
  lookup: EntityLookup;
  /** Fired when the chip is clicked — opens the references slide-over scoped to this entity. */
  onOpen?: (marker: Exclude<EntityMarker, { kind: 'file' }>) => void;
}

/**
 * Inline task / note / scratchpad chip rendered in the chat transcript.
 * Sibling to `MessageFileChip` for files. Looks up its title from the
 * `lookup` map (one bulk fetch per session in `useSessionEntities`).
 *
 * Click → calls `onOpen` so the parent can route to the right surface
 * (open the entity in a slide-over, focus the scratchpad pane, etc).
 * Hover → expanded tooltip with the resolved title + secondary info.
 *
 * Unknown ids fall back to a "missing" rendering so the user can see
 * something went sideways — never silently strip the chip.
 */
export function MessageEntityChip({ marker, lookup, onOpen }: MessageEntityChipProps) {
  if (marker.kind === 'scratchpad') {
    return <ScratchpadChip lookup={lookup} onOpen={onOpen} />;
  }
  if (marker.kind === 'task') {
    const task = lookup.tasksById.get(marker.id);
    return <TaskChip marker={marker} task={task} onOpen={onOpen} />;
  }
  if (marker.kind === 'note') {
    const note = lookup.notesById.get(marker.id);
    return <NoteChip marker={marker} note={note} onOpen={onOpen} />;
  }
  return null;
}

const CHIP_CLASSES =
  'inline-flex items-center align-baseline gap-1 px-1.5 py-0.5 mx-0.5 ' +
  'rounded-md border border-border bg-muted/40 text-foreground text-[12px] font-medium ' +
  'hover:border-foreground/30 hover:bg-muted/60 transition-colors cursor-pointer select-none';

function TaskChip({
  marker,
  task,
  onOpen,
}: {
  marker: { kind: 'task'; id: string };
  task?: { id: string; title: string; status: string };
  onOpen?: MessageEntityChipProps['onOpen'];
}) {
  const title = task?.title || 'Unknown task';
  const status = task?.status ?? 'unknown';
  const Icon = status === 'done' ? CheckSquare : Square;
  return (
    <button
      type="button"
      onClick={() => onOpen?.(marker)}
      className={cn(CHIP_CLASSES, !task && 'opacity-70')}
      title={task ? `Task: ${title}` : `Task ${marker.id} (not found)`}
    >
      <Icon size={11} className="shrink-0 text-muted-foreground/80" />
      <span className="text-[11px] truncate max-w-[200px]">{title}</span>
    </button>
  );
}

function NoteChip({
  marker,
  note,
  onOpen,
}: {
  marker: { kind: 'note'; id: string };
  note?: { id: string; title: string | null };
  onOpen?: MessageEntityChipProps['onOpen'];
}) {
  const title = note?.title || (note ? 'Untitled note' : 'Unknown note');
  return (
    <button
      type="button"
      onClick={() => onOpen?.(marker)}
      className={cn(CHIP_CLASSES, !note && 'opacity-70')}
      title={note ? `Note: ${title}` : `Note ${marker.id} (not found)`}
    >
      <StickyNote size={11} className="shrink-0 text-muted-foreground/80" />
      <span className="text-[11px] truncate max-w-[200px]">{title}</span>
    </button>
  );
}

function ScratchpadChip({
  lookup,
  onOpen,
}: {
  lookup: EntityLookup;
  onOpen?: MessageEntityChipProps['onOpen'];
}) {
  const [hover, setHover] = useState(false);
  const preview = lookup.scratchpad?.slice(0, 200) ?? '';
  return (
    <button
      type="button"
      onClick={() => onOpen?.({ kind: 'scratchpad' })}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={CHIP_CLASSES}
      title={hover && preview ? preview : 'Session scratchpad'}
    >
      <Notebook size={11} className="shrink-0 text-muted-foreground/80" />
      <span className="text-[11px]">Scratchpad</span>
    </button>
  );
}

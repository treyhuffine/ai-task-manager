'use client';

import { useState } from 'react';
import { Bot, CheckSquare, Square, StickyNote, Notebook } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EntityMarker } from '@/lib/entity-refs/parse-markers';
import type { ReferenceMarker } from '@/lib/entity-refs/open-event';
import { Tip } from '@/components/ui/tip';
import { AgentIcon } from '@/components/agents/agent-icon';
import { useOptionalWorkNavigation } from '@/contexts/work-context';
import { useWorkspace } from '@/hooks/use-workspaces';
import type { WorkspaceRecord } from '@/db/types';
import type { SourceChipTone } from '@/components/chat-ui/references/source-chip';

/** An agent as a chip draws it: its picture fields, what it's for, and whether it's still active. */
export type AgentChipRecord = Pick<WorkspaceRecord, 'id' | 'name' | 'emoji' | 'attachments' | 'areaId' | 'purpose' | 'status'>;

export interface EntityLookup {
  tasksById: Map<string, { id: string; title: string; status: string }>;
  notesById: Map<string, { id: string; title: string | null }>;
  /** Active agents, from the rail's list. An archived one is looked up on its own. */
  agentsById?: Map<string, AgentChipRecord>;
  /** Scratchpad lives on the session row — passed through so hover/click can preview. */
  scratchpad: string | null;
}

interface MessageEntityChipProps {
  marker: Exclude<EntityMarker, { kind: 'file' }>;
  lookup: EntityLookup;
  /** Fired when a task / note / scratchpad chip is clicked — opens the references slide-over scoped to this entity. */
  onOpen?: (marker: ReferenceMarker) => void;
  /** `bubble` in a sent message, whose colors invert the theme. Same tones as source chips. */
  tone?: SourceChipTone;
}

/**
 * Inline task / note / agent / scratchpad chip rendered in the chat transcript.
 * Sibling to `MessageFileChip` for files. Looks up its title from the
 * `lookup` map (one bulk fetch per session in `useSessionEntities`).
 *
 * Click → calls `onOpen` so the parent can route to the right surface
 * (open the entity in a slide-over, focus the scratchpad pane, etc). An
 * agent chip opens that agent through the document's navigation.
 * Hover → expanded tooltip with the resolved title + secondary info.
 *
 * Unknown ids fall back to a "missing" rendering so the user can see
 * something went sideways — never silently strip the chip.
 */
export function MessageEntityChip({ marker, lookup, onOpen, tone = 'surface' }: MessageEntityChipProps) {
  const look = LOOKS[tone];
  if (marker.kind === 'scratchpad') {
    return <ScratchpadChip lookup={lookup} onOpen={onOpen} look={look} />;
  }
  if (marker.kind === 'task') {
    const task = lookup.tasksById.get(marker.id);
    return <TaskChip marker={marker} task={task} onOpen={onOpen} look={look} />;
  }
  if (marker.kind === 'note') {
    const note = lookup.notesById.get(marker.id);
    return <NoteChip marker={marker} note={note} onOpen={onOpen} look={look} />;
  }
  if (marker.kind === 'agent') {
    return <AgentChip marker={marker} listed={lookup.agentsById?.get(marker.id)} look={look} />;
  }
  return null;
}

// Each chip's label is `self-baseline`, so the chip's baseline is its text's
// and it sits on the line with the words around it. Otherwise a flex box takes
// the first item's baseline, the bottom edge of an icon or agent picture.
const CHIP_BASE =
  'inline-flex items-center align-baseline gap-1 px-1.5 py-0.5 mx-0.5 ' +
  'rounded-md border text-[12px] font-medium transition-colors cursor-pointer select-none';

/**
 * A chip's colors where it sits. `surface` follows the theme. `bubble` sits
 * in a sent message, whose bubble inverts the theme, so it tints with the
 * bubble's own text color instead (as source chips do).
 */
const LOOKS = {
  surface: {
    chip: cn(CHIP_BASE, 'border-border bg-muted/40 text-foreground hover:border-foreground/30 hover:bg-muted/60'),
    still: 'cursor-default hover:border-border hover:bg-muted/40',
    icon: 'shrink-0 text-muted-foreground/80',
  },
  bubble: {
    chip: cn(CHIP_BASE, 'border-current/20 bg-current/10 text-inherit hover:border-current/35 hover:bg-current/15'),
    still: 'cursor-default hover:border-current/20 hover:bg-current/10',
    icon: 'shrink-0 opacity-70',
  },
} as const;
type ChipLook = (typeof LOOKS)[SourceChipTone];

function TaskChip({
  marker,
  task,
  onOpen,
  look,
}: {
  marker: { kind: 'task'; id: string };
  task?: { id: string; title: string; status: string };
  onOpen?: MessageEntityChipProps['onOpen'];
  look: ChipLook;
}) {
  const title = task?.title || 'Unknown task';
  const status = task?.status ?? 'unknown';
  const Icon = status === 'done' ? CheckSquare : Square;
  return (
    <Tip label={task ? title : `Task ${marker.id} (not found)`} onlyWhenTextHidden={!!task}>
      <button
        type="button"
        onClick={() => onOpen?.(marker)}
        className={cn(look.chip, !task && 'opacity-70')}
      >
        <Icon size={11} className={look.icon} />
        <span className="self-baseline text-[11px] truncate max-w-[200px]">{title}</span>
      </button>
    </Tip>
  );
}

function NoteChip({
  marker,
  note,
  onOpen,
  look,
}: {
  marker: { kind: 'note'; id: string };
  note?: { id: string; title: string | null };
  onOpen?: MessageEntityChipProps['onOpen'];
  look: ChipLook;
}) {
  const title = note?.title || (note ? 'Untitled note' : 'Unknown note');
  return (
    <Tip label={note ? title : `Note ${marker.id} (not found)`} onlyWhenTextHidden={!!note}>
      <button
        type="button"
        onClick={() => onOpen?.(marker)}
        className={cn(look.chip, !note && 'opacity-70')}
      >
        <StickyNote size={11} className={look.icon} />
        <span className="self-baseline text-[11px] truncate max-w-[200px]">{title}</span>
      </button>
    </Tip>
  );
}

function ScratchpadChip({
  lookup,
  onOpen,
  look,
}: {
  lookup: EntityLookup;
  onOpen?: MessageEntityChipProps['onOpen'];
  look: ChipLook;
}) {
  const [hover, setHover] = useState(false);
  const preview = lookup.scratchpad?.slice(0, 200) ?? '';
  return (
    <Tip label={hover && preview ? preview : 'Session scratchpad'}>
      <button
        type="button"
        onClick={() => onOpen?.({ kind: 'scratchpad' })}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={look.chip}
      >
        <Notebook size={11} className={look.icon} />
        <span className="self-baseline text-[11px]">Scratchpad</span>
      </button>
    </Tip>
  );
}

function AgentChip({
  marker,
  listed,
  look,
}: {
  marker: { kind: 'agent'; id: string };
  listed?: AgentChipRecord;
  look: ChipLook;
}) {
  // Only an agent missing from the active list (archived since, or gone)
  // costs a request of its own.
  const fetched = useWorkspace(listed ? null : marker.id);
  const agent: AgentChipRecord | undefined = listed ?? fetched.data ?? undefined;
  const navigation = useOptionalWorkNavigation();
  const name = agent?.name || 'Unknown agent';
  const archived = !!agent && agent.status !== 'active';
  const purpose = agent?.purpose?.trim();
  const tip = !agent
    ? `Agent ${marker.id} (not found)`
    : archived
      ? `${name} (archived)`
      : purpose || name;
  const icon = agent ? <AgentIcon workspace={agent} size="inline" /> : <Bot size={11} className={look.icon} />;
  const label = <span className="self-baseline text-[11px] truncate max-w-[200px]">{name}</span>;
  // Opens where the agent lives. Nothing to open for one that's gone, or
  // outside a document that can navigate (the gallery).
  const open = agent && !archived && navigation ? () => navigation.openAgent(agent.id) : null;
  return (
    <Tip label={tip} onlyWhenTextHidden={!!agent && !archived && !purpose}>
      {open ? (
        <button type="button" onClick={open} className={look.chip}>
          {icon}
          {label}
        </button>
      ) : (
        <span className={cn(look.chip, look.still, (!agent || archived) && 'opacity-70')}>
          {icon}
          {label}
        </span>
      )}
    </Tip>
  );
}

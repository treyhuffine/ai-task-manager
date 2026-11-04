'use client';

import { useState } from 'react';
import { Bot, CheckSquare, Layers, Square, StickyNote, Notebook } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EntityMarker, RemoteMarker, RemoteRecordKind } from '@/lib/entity-refs/parse-markers';
import type { ReferenceMarker } from '@/lib/entity-refs/open-event';
import { Tip } from '@/components/ui/tip';
import { AgentIcon } from '@/components/agents/agent-icon';
import { useOptionalWorkNavigation } from '@/contexts/work-context';
import { useWorkspace } from '@/hooks/use-workspaces';
import { useInMyRi, useLocatedRecord, useOpenTeamRecord, useTeamRecord } from '@/hooks/use-team-records';
import type { WorkspaceRecord } from '@/db/types';
import type { TeamRecordView } from '@/lib/spaces/team-links';
import type { SourceChipTone } from '@/components/chat-ui/references/source-chip';
import { describeTeamRecord } from '@/components/chat-ui/references/team-record';

/** An agent as a chip draws it: its picture fields, what it's for, and whether it's still active. */
export type AgentChipRecord = Pick<WorkspaceRecord, 'id' | 'name' | 'emoji' | 'attachments' | 'areaId' | 'purpose' | 'status'>;

export interface EntityLookup {
  tasksById: Map<string, { id: string; title: string; status: string }>;
  notesById: Map<string, { id: string; title: string | null }>;
  /** Active agents, from the rail's list. An archived one is looked up on its own. */
  agentsById?: Map<string, AgentChipRecord>;
  /** Scratchpad lives on the session row — passed through so hover/click can preview. */
  scratchpad: string | null;
  /** The bulk fetch came back, so an ID missing from the maps isn't in this chat's records. */
  loaded?: boolean;
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
 * something went sideways — never silently strip the chip. Before that, an ID
 * that isn't in this Home is looked for in connected teams.
 */
export function MessageEntityChip({ marker, lookup, onOpen, tone = 'surface' }: MessageEntityChipProps) {
  const look = LOOKS[tone];
  if (marker.kind === 'scratchpad') {
    return <ScratchpadChip lookup={lookup} onOpen={onOpen} look={look} />;
  }
  if (marker.kind === 'remote') {
    return <RemoteChip marker={marker} tone={tone} />;
  }
  if (marker.kind === 'task') {
    const task = lookup.tasksById.get(marker.id);
    if (!task && lookup.loaded) return <MissingChip marker={marker} onOpen={onOpen} tone={tone} />;
    return <TaskChip marker={marker} task={task} onOpen={onOpen} look={look} />;
  }
  if (marker.kind === 'note') {
    const note = lookup.notesById.get(marker.id);
    if (!note && lookup.loaded) return <MissingChip marker={marker} onOpen={onOpen} tone={tone} />;
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

const TEAM_RECORD_ICONS: Record<RemoteRecordKind, typeof Square> = { task: Square, note: StickyNote, area: Layers };

/** A record in a connected team as a chip, with its team, or why it can't be read. */
export function TeamRecordChip({ kind, id, view, tone = 'surface' }: { kind: RemoteRecordKind; id: string; view: TeamRecordView | null; tone?: SourceChipTone }) {
  const chip = LOOKS[tone];
  const open = useOpenTeamRecord();
  const record = view ? describeTeamRecord(kind, view) : null;
  const Icon = record?.done ? CheckSquare : TEAM_RECORD_ICONS[kind];
  const content = (
    <>
      <Icon size={11} className={chip.icon} />
      <span className="self-baseline text-[11px] truncate max-w-[200px]">{record?.label ?? 'Loading'}</span>
      {record?.team && !record.reason && <span className="self-baseline text-[10px] font-normal opacity-60 truncate max-w-[100px]">{record.team}</span>}
    </>
  );
  const dimmed = !record || record.muted;
  return (
    <Tip label={record?.reason ?? (record?.team ? `${record.label}, in ${record.team}` : record?.label ?? 'Loading')} onlyWhenTextHidden={!record?.reason}>
      {view && record?.opens ? (
        <button type="button" onClick={() => open(kind, id, view)} className={cn(chip.chip, dimmed && 'opacity-70')}>{content}</button>
      ) : (
        <span className={cn(chip.chip, chip.still, dimmed && 'opacity-70')}>{content}</span>
      )}
    </Tip>
  );
}

function RemoteChip({ marker, tone }: { marker: RemoteMarker; tone: SourceChipTone }) {
  const inMyRi = useInMyRi();
  const record = useTeamRecord(marker.recordKind, marker.homeId, marker.id, inMyRi);
  // Outside My Ri a link to another Home can't be read: a team only knows its own records.
  const unread: TeamRecordView = { state: inMyRi ? 'unreachable' : 'unknown_home', homeId: marker.homeId, teamName: null, title: null, status: null, localId: null };
  const view = !inMyRi || record.isError ? unread : record.data ?? null;
  return <TeamRecordChip kind={marker.recordKind} id={marker.id} view={view} tone={tone} />;
}

/** A bare ID this chat doesn't know. It may be a team's: old chats and agents that skipped `ref` write them bare. */
function MissingChip({ marker, onOpen, tone }: { marker: { kind: 'task' | 'note'; id: string }; onOpen?: MessageEntityChipProps['onOpen']; tone: SourceChipTone }) {
  const inMyRi = useInMyRi();
  const located = useLocatedRecord(marker.kind, marker.id, inMyRi).data;
  if (located?.state === 'team') return <TeamRecordChip kind={marker.kind} id={marker.id} view={located.record} tone={tone} />;
  const local = located?.state === 'local' ? { id: located.id, title: located.title ?? '', status: located.status ?? 'unknown' } : undefined;
  const unreachable = located?.state === 'missing' ? located.unreachable : [];
  const missingTip = unreachable.length ? `Not found in My Ri. ${unreachable.join(' and ')} can't be reached right now, so it may be there.` : undefined;
  const look = LOOKS[tone];
  return marker.kind === 'task'
    ? <TaskChip marker={{ kind: 'task', id: marker.id }} task={local} missingTip={missingTip} onOpen={onOpen} look={look} />
    : <NoteChip marker={{ kind: 'note', id: marker.id }} note={local} missingTip={missingTip} onOpen={onOpen} look={look} />;
}

function TaskChip({
  marker,
  task,
  missingTip,
  onOpen,
  look,
}: {
  marker: { kind: 'task'; id: string };
  task?: { id: string; title: string; status: string };
  missingTip?: string;
  onOpen?: MessageEntityChipProps['onOpen'];
  look: ChipLook;
}) {
  const title = task?.title || 'Unknown task';
  const status = task?.status ?? 'unknown';
  const Icon = status === 'done' ? CheckSquare : Square;
  return (
    <Tip label={task ? title : missingTip ?? `Task ${marker.id} (not found)`} onlyWhenTextHidden={!!task}>
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
  missingTip,
  onOpen,
  look,
}: {
  marker: { kind: 'note'; id: string };
  note?: { id: string; title: string | null };
  missingTip?: string;
  onOpen?: MessageEntityChipProps['onOpen'];
  look: ChipLook;
}) {
  const title = note?.title || (note ? 'Untitled note' : 'Unknown note');
  return (
    <Tip label={note ? title : missingTip ?? `Note ${marker.id} (not found)`} onlyWhenTextHidden={!!note}>
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

'use client';

import { useEntityLinkHome } from './entity-link-scope';
/**
 * Obsidian-style inline entity link for the note/task editor. Serializes to
 * the shared `[[task:<id>]]` / `[[note:<id>]]` marker
 * (src/lib/entity-refs/parse-markers.ts), so it round-trips through the
 * editor's markdown save/load AND feeds the derived backlink index
 * (docs/entity-links-spec.md). Distinct from the chat `entityChip` node, which
 * has no markdown hooks (chat hand-serializes on send); this one defines the
 * `@tiptap/markdown` `markdownTokenizer` / `parseMarkdown` / `renderMarkdown`
 * hooks so `getMarkdown()` emits the exact marker and `markdown.parse()`
 * rehydrates it into a live chip.
 *
 * The chip resolves the target's current title (so renames never rot the
 * link) and opens it on click.
 *
 * Where it looks depends on who owns the text (docs/team-links.md). A team's
 * text only ever looks in that team, so nothing in it can reach another Home.
 * In My Ri a marker can name a team, and an ID found nowhere here is looked
 * for in connected teams.
 */
import { useOptionalWorkNavigation } from '@/contexts/work-context';
import { useOptionalHomeContext } from '@/components/home/home-context';
import {
  Node,
  mergeAttributes,
  type NodeViewProps,
  type MarkdownToken,
  type JSONContent,
} from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import { useRouter } from 'next/navigation';
import { CheckSquare, Square, StickyNote } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEntityTitle } from '@/hooks/use-backlinks';
import { useInMyRi, useLocatedRecord, useOpenTeamRecord, useTeamRecord } from '@/hooks/use-team-records';
import { describeTeamRecord } from '@/components/chat-ui/references/team-record';
import type { TeamRecordView } from '@/lib/spaces/team-links';

import { handleChipBackspace } from '@/components/chat/editor/suggestion/chip-backspace';
import {
  ENTITY_LINK_RE,
  renderEntityLinkMarkdown,
  type EntityLinkKind,
} from './entity-link-marker';
import { Tip } from '@/components/ui/tip';

export const ENTITY_LINK_NAME = 'entityLink';

export type { EntityLinkKind };

export interface EntityLinkAttrs {
  kind: EntityLinkKind;
  id: string;
  /** The Home that holds the record, when it isn't the one that owns this text. */
  homeId?: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    entityLink: {
      insertEntityLink: (attrs: EntityLinkAttrs) => ReturnType;
    };
  }
}

export const EntityLinkNode = Node.create({
  name: ENTITY_LINK_NAME,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      kind: { default: 'note' },
      id: { default: '' },
      homeId: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-entity-link]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-entity-link': 'true' })];
  },

  // ── @tiptap/markdown round-trip ──
  markdownTokenizer: {
    name: ENTITY_LINK_NAME,
    level: 'inline',
    start: (src: string) => src.indexOf('[['),
    tokenize: (src: string): MarkdownToken | undefined => {
      const m = ENTITY_LINK_RE.exec(src);
      if (!m) return undefined;
      // Extra fields (kind/id) ride along for parseMarkdown; MarkdownToken
      // only declares type/raw, so widen through unknown.
      return {
        type: ENTITY_LINK_NAME,
        raw: m[0],
        kind: m[1] as EntityLinkKind,
        homeId: m[2] ?? null,
        id: m[3],
      } as unknown as MarkdownToken;
    },
  },
  parseMarkdown: (token: MarkdownToken): JSONContent => {
    const t = token as MarkdownToken & { kind: EntityLinkKind; id: string; homeId: string | null };
    return { type: ENTITY_LINK_NAME, attrs: { kind: t.kind, id: t.id, homeId: t.homeId } };
  },
  renderMarkdown: (node: JSONContent): string =>
    renderEntityLinkMarkdown((node.attrs?.kind as EntityLinkKind) ?? 'note', node.attrs?.id ?? '', node.attrs?.homeId),

  addCommands() {
    return {
      insertEntityLink:
        (attrs: EntityLinkAttrs) =>
        ({ commands }) =>
          commands.insertContent({ type: ENTITY_LINK_NAME, attrs }),
    };
  },

  addKeyboardShortcuts() {
    // Re-open the picker on backspace-adjacent, mirroring the chat chip.
    return {
      Backspace: ({ editor }) => handleChipBackspace(editor, ENTITY_LINK_NAME, '@'),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(EntityLinkView);
  },
});

function EntityLinkView({ node, selected }: NodeViewProps) {
  const { kind, id, homeId } = node.attrs as EntityLinkAttrs;
  const sourceHome = useEntityLinkHome();
  const inMyRi = useInMyRi();
  const thisHome = useOptionalHomeContext()?.home.id;
  if (sourceHome) {
    // A team's text can't reach beyond that team, whatever a marker in it names.
    return homeId && homeId !== sourceHome
      ? <LinkChip kind={kind} label={unavailable(kind)} muted selected={selected} />
      : <TeamLink kind={kind} id={id} homeId={sourceHome} inTeamText selected={selected} />;
  }
  if (homeId && inMyRi) return <TeamLink kind={kind} id={id} homeId={homeId} selected={selected} />;
  if (homeId && homeId !== thisHome) return <LinkChip kind={kind} label={unavailable(kind)} muted selected={selected} />;
  return <HomeLink kind={kind} id={id} inMyRi={inMyRi} selected={selected} />;
}

const unavailable = (kind: EntityLinkKind) => (kind === 'task' ? 'Task unavailable' : 'Note unavailable');

function TeamLink({ kind, id, homeId, inTeamText = false, selected }: { kind: EntityLinkKind; id: string; homeId: string; inTeamText?: boolean; selected: boolean }) {
  const { data, isError } = useTeamRecord(kind, homeId, id);
  const unread: TeamRecordView = { state: 'unreachable', homeId, teamName: null, title: null, status: null, localId: null };
  return <TeamRecordLink kind={kind} id={id} view={isError ? unread : data ?? null} inTeamText={inTeamText} selected={selected} />;
}

function TeamRecordLink({ kind, id, view, inTeamText = false, selected }: { kind: EntityLinkKind; id: string; view: TeamRecordView | null; inTeamText?: boolean; selected: boolean }) {
  const open = useOpenTeamRecord();
  const record = view ? describeTeamRecord(kind, view) : null;
  // Teammates see the same chip for a typo, a private ID and a missing record.
  const gone = inTeamText && view?.state === 'gone' && !view.localId;
  return (
    <LinkChip
      kind={kind}
      done={record?.done}
      label={gone ? unavailable(kind) : record?.label ?? (kind === 'task' ? 'Task' : 'Note')}
      team={!inTeamText && !record?.reason ? record?.team : null}
      tip={gone ? undefined : record?.reason ?? undefined}
      muted={!record || record.muted}
      selected={selected}
      onOpen={view && record?.opens ? () => open(kind, id, view) : undefined}
    />
  );
}

/** A marker with no Home: a record in the Home whose document this is. */
function HomeLink({ kind, id, inMyRi, selected }: { kind: EntityLinkKind; id: string; inMyRi: boolean; selected: boolean }) {
  const navigation = useOptionalWorkNavigation();
  const router = useRouter();
  // Read-only, title-only resolution — must not bump last_viewed_at or fetch
  // the full body (a document can hold many chips). See use-backlinks.ts.
  const { data, isSuccess } = useEntityTitle(kind, id);
  const missing = isSuccess && !data;
  const located = useLocatedRecord(kind, id, missing && inMyRi).data;
  if (located?.state === 'team') return <TeamRecordLink kind={kind} id={id} view={located.record} selected={selected} />;
  if (missing) {
    const unreachable = located?.state === 'missing' ? located.unreachable : [];
    return (
      <LinkChip
        kind={kind}
        label={inMyRi ? `${kind === 'task' ? 'Task' : 'Note'} not found` : unavailable(kind)}
        tip={unreachable.length ? `${unreachable.join(' and ')} can't be reached right now, so it may be there.` : undefined}
        muted
        selected={selected}
      />
    );
  }
  const open = () => {
    if (navigation) {
      if (kind === 'task') navigation.openTask(id);
      else navigation.openNote(id);
    } else {
      router.push(kind === 'task' ? `/task/${id}` : `/note/${id}`);
    }
  };
  return <LinkChip kind={kind} label={data?.title?.trim() || (kind === 'task' ? 'Untitled task' : 'Untitled note')} selected={selected} onOpen={open} />;
}

function LinkChip({ kind, label, team, tip, done = false, muted = false, selected, onOpen }: {
  kind: EntityLinkKind;
  label: string;
  team?: string | null;
  tip?: string;
  done?: boolean;
  muted?: boolean;
  selected: boolean;
  onOpen?: () => void;
}) {
  const Icon = kind === 'note' ? StickyNote : done ? CheckSquare : Square;
  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onOpen?.();
  };
  return (
    <Tip label={tip ?? (team ? `${label}, in ${team}` : label)} onlyWhenTextHidden={!tip}>
      <NodeViewWrapper
        as="span"
        contentEditable={false}
        data-drag-handle="false"
        onClick={open}
        className={cn(
          'inline-flex items-center align-baseline gap-1 px-1.5 py-0.5 mx-0.5',
          'rounded-md border bg-primary/5 text-foreground text-[12px] font-medium',
          'border-primary/20 transition-colors select-none',
          onOpen ? 'hover:border-primary/50 hover:bg-primary/10 cursor-pointer' : 'cursor-default',
          muted && 'opacity-70',
          selected && 'ring-2 ring-primary/40 border-primary/40',
        )}
      >
        <Icon size={11} className="text-primary/70 shrink-0" />
        <span className="text-[11px] truncate max-w-[240px]">{label}</span>
        {team && <span className="text-[10px] font-normal opacity-60 truncate max-w-[100px]">{team}</span>}
      </NodeViewWrapper>
    </Tip>
  );
}

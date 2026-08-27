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
 */
import {
  Node,
  mergeAttributes,
  type NodeViewProps,
  type MarkdownToken,
  type JSONContent,
} from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import { useRouter } from 'next/navigation';
import { Square, StickyNote } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEntityTitle } from '@/hooks/use-backlinks';
import { useOptionalDashboard } from '@/contexts/dashboard-context';
import { handleChipBackspace } from '@/components/chat/editor/suggestion/chip-backspace';
import {
  ENTITY_LINK_RE,
  renderEntityLinkMarkdown,
  type EntityLinkKind,
} from './entity-link-marker';

export const ENTITY_LINK_NAME = 'entityLink';

export type { EntityLinkKind };

export interface EntityLinkAttrs {
  kind: EntityLinkKind;
  id: string;
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
        id: m[2],
      } as unknown as MarkdownToken;
    },
  },
  parseMarkdown: (token: MarkdownToken): JSONContent => {
    const t = token as MarkdownToken & { kind: EntityLinkKind; id: string };
    return { type: ENTITY_LINK_NAME, attrs: { kind: t.kind, id: t.id } };
  },
  renderMarkdown: (node: JSONContent): string =>
    renderEntityLinkMarkdown((node.attrs?.kind as EntityLinkKind) ?? 'note', node.attrs?.id ?? ''),

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
  const attrs = node.attrs as EntityLinkAttrs;
  const isTask = attrs.kind === 'task';
  const dashboard = useOptionalDashboard();
  const router = useRouter();

  // Read-only, title-only resolution — must not bump last_viewed_at or fetch
  // the full body (a document can hold many chips). See use-backlinks.ts.
  const { data } = useEntityTitle(attrs.kind, attrs.id);
  const title = data?.title?.trim() || (isTask ? 'Untitled task' : 'Untitled note');
  const Icon = isTask ? Square : StickyNote;

  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dashboard) {
      if (isTask) dashboard.openTask(attrs.id);
      else dashboard.openNote(attrs.id);
    } else {
      router.push(isTask ? `/task/${attrs.id}` : `/note/${attrs.id}`);
    }
  };

  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      data-drag-handle="false"
      onClick={open}
      className={cn(
        'inline-flex items-center align-baseline gap-1 px-1.5 py-0.5 mx-0.5',
        'rounded-md border bg-primary/5 text-foreground text-[12px] font-medium',
        'border-primary/20 hover:border-primary/50 hover:bg-primary/10 transition-colors',
        'cursor-pointer select-none',
        selected && 'ring-2 ring-primary/40 border-primary/40',
      )}
      title={`${isTask ? 'Task' : 'Note'}: ${title}`}
    >
      <Icon size={11} className="text-primary/70 shrink-0" />
      <span className="text-[11px] truncate max-w-[240px]">{title}</span>
    </NodeViewWrapper>
  );
}

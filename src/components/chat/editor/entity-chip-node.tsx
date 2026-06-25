/**
 * Inline entity reference chip — sibling to FileChipNode (attachments)
 * and MentionChipNode (worktree files / folders). Renders as
 * `[icon] title` inline in the composer flow, with distinct visuals
 * by entity kind so the user can tell at a glance what they're
 * referencing:
 *
 *   - task → CheckSquare icon (☐), title text
 *   - note → StickyNote icon (📝), title text
 *   - scratchpad → Notebook icon, literal "Scratchpad" label
 *
 * Serialized to `[[task:<id>]]` / `[[note:<id>]]` / `[[scratchpad]]`
 * markers — matched by `src/lib/entity-refs/parse-markers.ts` on both
 * the render side (transcript chip swap) and the server side (hydration).
 *
 * Inserted by the `@`-picker (`mention-menu/extension.ts`) when the
 * user selects a task / note / scratchpad row. Backspace adjacent to
 * the chip removes it the same way the file mention chip does.
 */
import { Node, mergeAttributes, type NodeViewProps } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import { X, CheckSquare, Square, StickyNote, Notebook } from 'lucide-react';
import { cn } from '@/lib/utils';
import { handleChipBackspace } from './suggestion/chip-backspace';

export const ENTITY_CHIP_NAME = 'entityChip';

export type EntityChipKind = 'task' | 'note' | 'scratchpad';

export interface EntityChipAttrs {
  /** Discriminator. */
  kind: EntityChipKind;
  /** Empty for scratchpad (it's session-scoped, no id needed). */
  id: string;
  /** Display label. For scratchpad we fall back to "Scratchpad". */
  title: string;
  /** Optional sub-state for tasks (active / done / archived). */
  status?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    entityChip: {
      /** Insert an entity reference chip at the current cursor position. */
      insertEntityChip: (attrs: EntityChipAttrs) => ReturnType;
    };
  }
}

export const EntityChipNode = Node.create<{}>({
  name: ENTITY_CHIP_NAME,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      kind: { default: 'task' },
      id: { default: '' },
      title: { default: '' },
      status: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-entity-chip]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-entity-chip': 'true' })];
  },

  addCommands() {
    return {
      insertEntityChip:
        (attrs: EntityChipAttrs) =>
        ({ commands }) =>
          commands.insertContent({ type: ENTITY_CHIP_NAME, attrs }),
    };
  },

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => handleChipBackspace(editor, ENTITY_CHIP_NAME, '@'),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(EntityChipView);
  },
});

function entityIcon(attrs: EntityChipAttrs) {
  if (attrs.kind === 'scratchpad') {
    return <Notebook size={11} className="text-muted-foreground/80 shrink-0" />;
  }
  if (attrs.kind === 'task') {
    if (attrs.status === 'done') {
      return <CheckSquare size={11} className="text-muted-foreground/80 shrink-0" />;
    }
    return <Square size={11} className="text-muted-foreground/80 shrink-0" />;
  }
  return <StickyNote size={11} className="text-muted-foreground/80 shrink-0" />;
}

function entityLabel(attrs: EntityChipAttrs): string {
  if (attrs.kind === 'scratchpad') return 'Scratchpad';
  return attrs.title || (attrs.kind === 'task' ? 'Untitled task' : 'Untitled note');
}

function EntityChipView({ node, editor, getPos, selected }: NodeViewProps) {
  const attrs = node.attrs as EntityChipAttrs;

  const handleRemove = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos == null) return;
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .run();
  };

  const label = entityLabel(attrs);
  const tooltip =
    attrs.kind === 'scratchpad'
      ? 'Session scratchpad: inlined for the agent on send'
      : `${attrs.kind === 'task' ? 'Task' : 'Note'}: ${label}`;

  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      data-drag-handle="false"
      className={cn(
        'inline-flex items-center align-baseline gap-1 px-1.5 py-0.5 mx-0.5',
        'rounded-md border bg-muted/40 text-foreground text-[12px] font-medium',
        'border-border hover:border-foreground/30 transition-colors',
        'cursor-default select-none',
        selected && 'ring-2 ring-primary/40 border-primary/40',
      )}
      title={tooltip}
    >
      {entityIcon(attrs)}
      <span className="text-[11px] truncate max-w-[200px]">{label}</span>
      <button
        type="button"
        onMouseDown={handleRemove}
        className="ml-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
        aria-label={`Remove ${label}`}
        tabIndex={-1}
      >
        <X size={10} />
      </button>
    </NodeViewWrapper>
  );
}

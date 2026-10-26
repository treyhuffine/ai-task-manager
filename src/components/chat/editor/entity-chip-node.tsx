/**
 * Inline entity reference chip — sibling to FileChipNode (attachments)
 * and MentionChipNode (worktree files / folders). Renders as
 * `[icon] title` inline in the composer flow, with distinct visuals
 * by entity kind so the user can tell at a glance what they're
 * referencing:
 *
 *   - task → CheckSquare icon (☐), title text
 *   - note → StickyNote icon (📝), title text
 *   - agent → the agent's own icon (`AgentIcon`), its name
 *   - scratchpad → Notebook icon, literal "Scratchpad" label
 *
 * Serialized to `[[task:<id>]]` / `[[note:<id>]]` / `[[agent:<id>]]` /
 * `[[scratchpad]]` markers — matched by `src/lib/entity-refs/parse-markers.ts`
 * on both the render side (transcript chip swap) and the server side
 * (hydration).
 *
 * Inserted by the `@`-picker (`mention-menu/extension.ts`) when the
 * user selects an agent / task / note / scratchpad row. Backspace adjacent
 * to the chip removes it the same way the file mention chip does.
 */
import { Node, mergeAttributes, type NodeViewProps } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import { X, CheckSquare, Square, StickyNote, Notebook } from 'lucide-react';
import { cn } from '@/lib/utils';
import { handleChipBackspace } from './suggestion/chip-backspace';
import { Tip } from '@/components/ui/tip';
import { AgentIcon, AgentInitials } from '@/components/agents/agent-icon';
import { useWorkspaces } from '@/hooks/use-workspaces';

export const ENTITY_CHIP_NAME = 'entityChip';

export type EntityChipKind = 'task' | 'note' | 'agent' | 'scratchpad';

export interface EntityChipAttrs {
  /** Discriminator. */
  kind: EntityChipKind;
  /** Empty for scratchpad (it's session-scoped, no id needed). */
  id: string;
  /** Display label: the title, or an agent's name. For scratchpad we fall back to "Scratchpad". */
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

export const EntityChipNode = Node.create<Record<string, never>>({
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
  if (attrs.kind === 'agent') return attrs.title || 'Agent';
  return attrs.title || (attrs.kind === 'task' ? 'Untitled task' : 'Untitled note');
}

function EntityChipView(props: NodeViewProps) {
  const attrs = props.node.attrs as EntityChipAttrs;
  if (attrs.kind === 'agent') return <AgentChipView {...props} />;
  const label = entityLabel(attrs);
  const scratchpad = attrs.kind === 'scratchpad';
  return (
    <ChipFrame
      {...props}
      icon={entityIcon(attrs)}
      label={label}
      tip={scratchpad ? 'Session scratchpad: inlined for the agent on send' : label}
      tipOnlyWhenTextHidden={!scratchpad}
    />
  );
}

/**
 * An agent drawn as the rail draws it, from the same list (its initials
 * until that loads). The tooltip says what it's for, which its name on the
 * chip doesn't.
 */
function AgentChipView(props: NodeViewProps) {
  const attrs = props.node.attrs as EntityChipAttrs;
  const { data: agents } = useWorkspaces({ status: 'active' });
  const agent = agents?.find((a) => a.id === attrs.id);
  const label = entityLabel(attrs);
  const purpose = agent?.purpose?.trim();
  return (
    <ChipFrame
      {...props}
      icon={agent ? <AgentIcon workspace={agent} size="xs" /> : <AgentInitials name={label} size="xs" />}
      label={label}
      tip={purpose || label}
      tipOnlyWhenTextHidden={!purpose}
    />
  );
}

function ChipFrame({
  node,
  editor,
  getPos,
  selected,
  icon,
  label,
  tip,
  tipOnlyWhenTextHidden,
}: NodeViewProps & { icon: React.ReactNode; label: string; tip: string; tipOnlyWhenTextHidden: boolean }) {
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

  return (
    <Tip label={tip} onlyWhenTextHidden={tipOnlyWhenTextHidden}>
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
      >
        {icon}
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
    </Tip>
  );
}

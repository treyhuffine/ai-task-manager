/**
 * Inline paste chip — a Tiptap atom node that renders as a small file
 * chip directly in the flow of typed text. Position-preserving (where
 * the user pasted, the chip lives), removable (X click or Backspace
 * adjacent), serializable to a marker token (`[[paste:id]]`) for the
 * execution chat path or a `FileUIPart` for the orchestrator path.
 *
 * The node carries display-only attrs (id, filename, size, lineCount).
 * The actual pasted content lives in an editor-level Map (see
 * pasteContentStore in chat-input-editor.tsx) keyed by id, so giant
 * pastes don't explode the editor doc or get echoed in every keystroke.
 */

import {
  Node, mergeAttributes, type NodeViewProps,
} from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import { FileText, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatAttachmentSize } from '@/lib/chat/paste-attachments';

export const PASTE_CHIP_NAME = 'pasteChip';

export interface PasteChipAttrs {
  id: string;
  filename: string;
  size: number;
  lineCount: number;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pasteChip: {
      /** Insert a paste chip at the current cursor position. */
      insertPasteChip: (attrs: PasteChipAttrs) => ReturnType;
    };
  }
}

export const PasteChipNode = Node.create<{}>({
  name: PASTE_CHIP_NAME,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      id: { default: '' },
      filename: { default: '' },
      size: { default: 0 },
      lineCount: { default: 0 },
    };
  },

  parseHTML() {
    return [{ tag: `span[data-paste-chip]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-paste-chip': 'true' }),
    ];
  },

  addCommands() {
    return {
      insertPasteChip:
        (attrs: PasteChipAttrs) =>
        ({ commands }) => {
          // Insert a paragraph break neither before nor after — chip is
          // inline so it slots straight into the cursor's text run.
          return commands.insertContent({
            type: PASTE_CHIP_NAME,
            attrs,
          });
        },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(PasteChipView);
  },
});

function PasteChipView({ node, editor, getPos, selected }: NodeViewProps) {
  const { filename, size, lineCount } = node.attrs as PasteChipAttrs;

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

  // contentEditable=false so caret skips over the chip rather than
  // entering it; users can still backspace-from-right to select it.
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
      title={`${filename} · ${formatAttachmentSize(size)}${lineCount ? ` · ${lineCount} lines` : ''}`}
    >
      <FileText size={11} className="text-muted-foreground/80 shrink-0" />
      <span className="font-mono text-[11px] truncate max-w-[180px]">{filename}</span>
      <button
        type="button"
        onMouseDown={handleRemove}
        className="ml-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
        aria-label={`Remove ${filename}`}
        tabIndex={-1}
      >
        <X size={10} />
      </button>
    </NodeViewWrapper>
  );
}

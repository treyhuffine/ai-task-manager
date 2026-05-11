/**
 * Inline file chip — a Tiptap atom node that renders as a small chip
 * directly in the flow of typed text. Position-preserving (where the
 * user pasted/dropped, the chip lives), removable (X click or
 * Backspace adjacent), serializable to a marker token
 * (`[[file:<file_name>]]`) for the execution chat path or a
 * `FileUIPart` for the orchestrator path.
 *
 * The node carries the same `Attachment` shape that tasks/notes/areas
 * use — `file_name | original_name | mime_type | size | uploaded_at`
 * — so the editor speaks the same language as every other attachment
 * surface in the app. No separate marker id; `file_name` is the
 * stable key.
 */

import {
  Node, mergeAttributes, type NodeViewProps,
} from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import { FileText, X, Image as ImageIcon, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { attachmentUrl } from '@/lib/attachments/view';
import type { Attachment } from '@/db/types';

export const FILE_CHIP_NAME = 'fileChip';

/**
 * Chip attrs are a superset of the persisted `Attachment` shape:
 *   - `pending` true while the upload is in flight (placeholder chip,
 *     spinner shown). file_name in that state is a temporary uuid
 *     used to find + replace the chip after upload completes.
 *   - `pending_id` matches what `uploadAndInsert` stashes so the
 *     post-upload replace can find this exact chip.
 */
export interface FileChipAttrs extends Attachment {
  pending?: boolean;
  pending_id?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fileChip: {
      /** Insert a file chip at the current cursor position. */
      insertFileChip: (attrs: FileChipAttrs) => ReturnType;
    };
  }
}

export const FileChipNode = Node.create<{}>({
  name: FILE_CHIP_NAME,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      file_name: { default: '' },
      original_name: { default: '' },
      mime_type: { default: 'application/octet-stream' },
      size: { default: 0 },
      uploaded_at: { default: '' },
      pending: { default: false },
      pending_id: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: `span[data-file-chip]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-file-chip': 'true' }),
    ];
  },

  addCommands() {
    return {
      insertFileChip:
        (attrs: FileChipAttrs) =>
        ({ commands }) => {
          // Insert a paragraph break neither before nor after — chip is
          // inline so it slots straight into the cursor's text run.
          return commands.insertContent({
            type: FILE_CHIP_NAME,
            attrs,
          });
        },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileChipView);
  },
});

function FileChipView({ node, editor, getPos, selected }: NodeViewProps) {
  const attrs = node.attrs as FileChipAttrs;
  const { file_name, original_name, mime_type, size, pending } = attrs;
  const display = original_name || file_name;
  const isImage = mime_type.startsWith('image/');

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
        pending && 'opacity-70',
      )}
      title={pending ? `Uploading ${display}…` : `${display}${size ? ` · ${formatSize(size)}` : ''}`}
    >
      {pending ? (
        <Loader2 size={11} className="text-muted-foreground/80 shrink-0 animate-spin" />
      ) : isImage ? (
        <img
          src={attachmentUrl(file_name)}
          alt={display}
          className="w-4 h-4 rounded object-cover shrink-0"
        />
      ) : mime_type.startsWith('image/') ? (
        <ImageIcon size={11} className="text-muted-foreground/80 shrink-0" />
      ) : (
        <FileText size={11} className="text-muted-foreground/80 shrink-0" />
      )}
      <span className="font-mono text-[11px] truncate max-w-[180px]">{display}</span>
      <button
        type="button"
        onMouseDown={handleRemove}
        className="ml-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
        aria-label={`Remove ${display}`}
        tabIndex={-1}
      >
        <X size={10} />
      </button>
    </NodeViewWrapper>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 100) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

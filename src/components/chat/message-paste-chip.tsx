'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  formatAttachmentSize, formatAttachmentLineCount,
} from '@/lib/chat/paste-attachments';

interface MessagePasteChipProps {
  filename: string;
  content: string;
  /** Layout density. `inline` for chips embedded in a sentence; `block` for their own line. */
  variant?: 'inline' | 'block';
}

/**
 * Read-only paste chip rendered in the transcript under (or inside)
 * a chat message. Click to expand the full content inline. Distinct
 * from the editor's `PasteChip` node, which is interactive and lives
 * inside Tiptap.
 *
 * Why inline expand instead of modal/slideout: the user picked
 * "expandable card under message" and it keeps the conversation in a
 * single scroll plane — no focus-pulling, no second pane to chase.
 */
export function MessagePasteChip({ filename, content, variant = 'inline' }: MessagePasteChipProps) {
  const [open, setOpen] = useState(false);
  const lineCount = formatAttachmentLineCount(content);
  const size = new Blob([content]).size;

  return (
    <span className={cn(variant === 'block' && 'block my-1')}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center align-baseline gap-1 px-1.5 py-0.5 mx-0.5',
          'rounded-md border border-border bg-muted/40 text-foreground text-[12px] font-medium',
          'hover:border-foreground/30 hover:bg-muted/60 transition-colors',
          'cursor-pointer',
        )}
        title={`${filename} · ${formatAttachmentSize(size)} · ${lineCount} lines`}
      >
        <FileText size={11} className="text-muted-foreground/80 shrink-0" />
        <span className="font-mono text-[11px] truncate max-w-[200px]">{filename}</span>
        <span className="text-[10px] text-muted-foreground/70 ml-0.5">
          {lineCount} {lineCount === 1 ? 'line' : 'lines'}
        </span>
        {open ? (
          <ChevronDown size={10} className="text-muted-foreground/70" />
        ) : (
          <ChevronRight size={10} className="text-muted-foreground/70" />
        )}
      </button>

      {open && (
        <span className="block mt-1 mb-2 rounded-md border border-border bg-muted/30 max-h-72 overflow-y-auto">
          <pre className="text-[11px] font-mono text-foreground/90 px-3 py-2 whitespace-pre-wrap break-words">
            {content}
          </pre>
        </span>
      )}
    </span>
  );
}

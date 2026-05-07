'use client';

import { Check, Copy, FileText, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  type PasteAttachment,
  formatAttachmentLineCount,
  formatAttachmentSize,
} from '@/lib/chat/paste-attachments';
import { cn } from '@/lib/utils';

interface PasteAttachmentChipProps {
  attachment: PasteAttachment;
  onRemove?: (id: string) => void;
  /** Tighter padding/text for compact panels (slideout chat). */
  compact?: boolean;
}

export function PasteAttachmentChip({
  attachment,
  onRemove,
  compact,
}: PasteAttachmentChipProps) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = formatAttachmentLineCount(attachment.content);

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={cn(
          'group inline-flex items-center gap-1.5 rounded-md border border-border bg-card text-foreground transition-colors hover:border-primary/40 hover:bg-card/80',
          compact ? 'h-6 px-1.5 text-[10px]' : 'h-7 px-2 text-[11px]',
        )}
        title={`${attachment.filename} — click to view`}
      >
        <FileText
          size={compact ? 10 : 12}
          className="shrink-0 text-muted-foreground"
        />
        <span className="max-w-[12ch] truncate font-medium">
          {attachment.filename}
        </span>
        <span className="text-muted-foreground/70">
          {lineCount} lines · {formatAttachmentSize(attachment.size)}
        </span>
        {onRemove && (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Remove ${attachment.filename}`}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(attachment.id);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onRemove(attachment.id);
              }
            }}
            className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground"
          >
            <X size={compact ? 9 : 10} />
          </span>
        )}
      </button>

      {expanded && (
        <PasteAttachmentExpandModal
          attachment={attachment}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  );
}

interface PasteAttachmentListProps {
  attachments: PasteAttachment[];
  onRemove?: (id: string) => void;
  compact?: boolean;
  className?: string;
}

export function PasteAttachmentList({
  attachments,
  onRemove,
  compact,
  className,
}: PasteAttachmentListProps) {
  if (attachments.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {attachments.map((a) => (
        <PasteAttachmentChip
          key={a.id}
          attachment={a}
          onRemove={onRemove}
          compact={compact}
        />
      ))}
    </div>
  );
}

interface PasteAttachmentExpandModalProps {
  attachment: PasteAttachment;
  onClose: () => void;
}

function PasteAttachmentExpandModal({
  attachment,
  onClose,
}: PasteAttachmentExpandModalProps) {
  const [copied, setCopied] = useState(false);
  const lineCount = formatAttachmentLineCount(attachment.content);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(attachment.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable in non-secure contexts; silently ignore.
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <FileText size={14} className="shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium text-foreground">
              {attachment.filename}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {lineCount} lines · {formatAttachmentSize(attachment.size)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Copy to clipboard"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <pre className="flex-1 overflow-auto bg-muted/30 p-4 font-mono text-[12px] leading-relaxed text-foreground whitespace-pre-wrap break-words">
          {attachment.content}
        </pre>
      </div>
    </div>
  );
}

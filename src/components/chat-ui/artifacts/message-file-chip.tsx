'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Download, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { attachmentUrl } from '@/lib/attachments/view';
import { getAuthToken } from '@/lib/api/client';
import type { Attachment } from '@/db/types';
import { Tip } from '@/components/ui/tip';
import { ImagePreviewCard } from './image-preview-card';

interface MessageFileChipProps {
  attachment: Attachment;
  /** Layout density. `inline` for chips embedded in a sentence; `block` for their own line. */
  variant?: 'inline' | 'block';
  /** Shared work in My Ri resolves files through its team's store. */
  fileUrl?: (fileName: string) => string;
}

/**
 * Read-only file chip rendered in the transcript under (or inside)
 * a chat message. Branches on mime type:
 *
 *   - image/* → small thumbnail; click to view full size in a lightbox.
 *   - text/*  → expandable chip; click toggles inline content fetch.
 *   - other   → file chip with a download link.
 *
 * Distinct from the editor's `FileChipNode`, which is interactive and
 * lives inside Tiptap.
 */
export function MessageFileChip({ attachment, variant = 'inline', fileUrl = attachmentUrl }: MessageFileChipProps) {
  const { fileName, originalName, mimeType, size } = attachment;
  const display = originalName || fileName;
  const isImage = mimeType.startsWith('image/');
  const isText = mimeType.startsWith('text/');
  const url = fileUrl(fileName);

  if (isImage) {
    return <span className={cn(variant === 'block' && 'block my-1')}><ImagePreviewCard src={url} name={display} /></span>;
  }
  if (isText) {
    return <TextExpandChip url={url} display={display} variant={variant} size={size} />;
  }
  return <DownloadChip url={url} display={display} variant={variant} size={size} />;
}

// ─── Text variant ──────────────────────────────────────────────

function TextExpandChip({ url, display, variant, size }: {
  url: string; display: string; variant: 'inline' | 'block'; size: number;
}) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (content != null || loading) return;
    setLoading(true);
    setError(null);
    try {
      const token = getAuthToken();
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setContent(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <span className={cn(variant === 'block' && 'block my-1')}>
      <Tip label={`${display} · ${formatSize(size)}`} onlyWhenTextHidden>
        <button
          type="button"
          onClick={handleToggle}
          className={cn(
            'inline-flex items-center align-baseline gap-1 px-1.5 py-0.5 mx-0.5',
            'rounded-md border border-border bg-muted/40 text-foreground text-[12px] font-medium',
            'hover:border-foreground/30 hover:bg-muted/60 transition-colors',
            'cursor-pointer',
          )}
        >
          <FileText size={11} className="text-muted-foreground/80 shrink-0" />
          <span className="font-mono text-[11px] truncate max-w-[200px]">{display}</span>
          <span className="text-[10px] text-muted-foreground/70 ml-0.5">{formatSize(size)}</span>
          {open ? (
            <ChevronDown size={10} className="text-muted-foreground/70" />
          ) : (
            <ChevronRight size={10} className="text-muted-foreground/70" />
          )}
        </button>
      </Tip>
      {open && (
        <span className="block mt-1 mb-2 rounded-md border border-border bg-muted/30 max-h-72 overflow-y-auto">
          {loading ? (
            <span className="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground">
              <Loader2 size={11} className="animate-spin" />
              Loading…
            </span>
          ) : error ? (
            <span className="block px-3 py-2 text-[11px] text-destructive">Failed to load: {error}</span>
          ) : (
            <pre className="text-[11px] font-mono text-foreground/90 px-3 py-2 whitespace-pre-wrap break-words">
              {content ?? ''}
            </pre>
          )}
        </span>
      )}
    </span>
  );
}

// ─── Download variant ─────────────────────────────────────────

function DownloadChip({ url, display, variant, size }: {
  url: string; display: string; variant: 'inline' | 'block'; size: number;
}) {
  return (
    <span className={cn(variant === 'block' && 'block my-1')}>
      <Tip label={`${display} · ${formatSize(size)}`} onlyWhenTextHidden>
        <a
          href={url}
          download={display}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'inline-flex items-center align-baseline gap-1 px-1.5 py-0.5 mx-0.5',
            'rounded-md border border-border bg-muted/40 text-foreground text-[12px] font-medium',
            'hover:border-foreground/30 hover:bg-muted/60 transition-colors',
            'cursor-pointer no-underline',
          )}
        >
          <Download size={11} className="text-muted-foreground/80 shrink-0" />
          <span className="font-mono text-[11px] truncate max-w-[200px]">{display}</span>
          <span className="text-[10px] text-muted-foreground/70 ml-0.5">{formatSize(size)}</span>
        </a>
      </Tip>
    </span>
  );
}

// ─── Internals ─────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 100) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

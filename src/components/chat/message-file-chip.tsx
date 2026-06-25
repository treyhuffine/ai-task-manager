'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Image as ImageIcon, Download, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { attachmentUrl } from '@/lib/attachments/view';
import { getAuthToken } from '@/lib/api/client';
import type { Attachment } from '@/db/types';

interface MessageFileChipProps {
  attachment: Attachment;
  /** Layout density. `inline` for chips embedded in a sentence; `block` for their own line. */
  variant?: 'inline' | 'block';
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
export function MessageFileChip({ attachment, variant = 'inline' }: MessageFileChipProps) {
  const { fileName, originalName, mimeType, size } = attachment;
  const display = originalName || fileName;
  const isImage = mimeType.startsWith('image/');
  const isText = mimeType.startsWith('text/');
  const url = attachmentUrl(fileName);

  if (isImage) {
    return <ImageThumb url={url} display={display} variant={variant} size={size} />;
  }
  if (isText) {
    return <TextExpandChip url={url} display={display} variant={variant} size={size} />;
  }
  return <DownloadChip url={url} display={display} variant={variant} size={size} mime={mimeType} />;
}

// ─── Image variant ─────────────────────────────────────────────

function ImageThumb({ url, display, variant, size }: {
  url: string; display: string; variant: 'inline' | 'block'; size: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className={cn(variant === 'block' && 'block my-1')}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-block align-middle mx-0.5 rounded-md border border-border overflow-hidden',
          'hover:border-foreground/30 transition-colors',
          'cursor-zoom-in',
        )}
        title={`${display} · ${formatSize(size)}`}
      >
        <AuthedImage src={url} alt={display} className="block max-h-32 max-w-[14rem] object-cover" />
      </button>
      {open && <Lightbox url={url} alt={display} onClose={() => setOpen(false)} />}
    </span>
  );
}

function Lightbox({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <span
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-6 cursor-zoom-out"
      onClick={onClose}
    >
      <AuthedImage
        src={url}
        alt={alt}
        className="max-h-full max-w-full object-contain rounded-md shadow-2xl"
      />
    </span>
  );
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
      <button
        type="button"
        onClick={handleToggle}
        className={cn(
          'inline-flex items-center align-baseline gap-1 px-1.5 py-0.5 mx-0.5',
          'rounded-md border border-border bg-muted/40 text-foreground text-[12px] font-medium',
          'hover:border-foreground/30 hover:bg-muted/60 transition-colors',
          'cursor-pointer',
        )}
        title={`${display} · ${formatSize(size)}`}
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

function DownloadChip({ url, display, variant, size, mime }: {
  url: string; display: string; variant: 'inline' | 'block'; size: number; mime: string;
}) {
  return (
    <span className={cn(variant === 'block' && 'block my-1')}>
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
        title={`${display} · ${mime} · ${formatSize(size)}`}
      >
        <Download size={11} className="text-muted-foreground/80 shrink-0" />
        <span className="font-mono text-[11px] truncate max-w-[200px]">{display}</span>
        <span className="text-[10px] text-muted-foreground/70 ml-0.5">{formatSize(size)}</span>
      </a>
    </span>
  );
}

// ─── Internals ─────────────────────────────────────────────────

/**
 * Browser image fetches don't carry our Bearer token, so a vanilla
 * `<img src={attachmentUrl}>` would 401 against the protected serve
 * route. Fetch the bytes, blob-URL them, swap the src.
 */
function AuthedImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [objUrl, setObjUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let revoked = false;
    let url: string | null = null;
    (async () => {
      try {
        const token = getAuthToken();
        const res = await fetch(src, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
        if (!revoked) setObjUrl(url);
        else URL.revokeObjectURL(url);
      } catch {
        setError(true);
      }
    })();
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src]);

  if (error) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-destructive">
        <ImageIcon size={11} />
        Failed to load
      </span>
    );
  }
  if (!objUrl) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-muted-foreground">
        <Loader2 size={11} className="animate-spin" />
        Loading…
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={objUrl} alt={alt} className={className} />;
}

function formatSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 100) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

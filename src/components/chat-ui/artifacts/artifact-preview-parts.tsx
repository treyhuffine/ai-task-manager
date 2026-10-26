'use client';

import { useId } from 'react';
import { ChevronLeft, ChevronRight, Copy, Download, Expand, File, FileArchive, FileAudio, FileCode2, FileText, FileVideo, ImageIcon, PanelLeft, PanelRight, Sheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tip';
import { HtmlView } from '@/components/chat-ui/artifacts/html-view';
import { HOTKEYS } from '@/constants/commands';
import { sessionFolder } from '@/lib/folders/source';
import type { PreviewPlace } from '@/lib/client/preview-place';
import { cn } from '@/lib/utils';
import { previewCopySource, previewDownload, type ArtifactPreview } from './artifact-previews';
import { PreviewImage } from './preview-image';
import { PdfView } from './pdf-view';
import { TextFileView } from './text-file-view';
import { copyText } from '@/lib/clipboard';
import { FilePreviewView } from './file-preview-view';
import { filePreviewKind } from '@/lib/files/preview-types';
import { FileSourceTip } from './file-source-tip';
import { useSessionCookieReady } from '@/hooks/use-session-cookie-ready';
import { syncSessionCookie } from '@/lib/api/client';

/** The pieces the large dialog and the view beside a chat share. */

export function previewName(preview: ArtifactPreview): string {
  return preview.kind === 'html' || preview.kind === 'text' ? preview.path.split('/').at(-1) || preview.path : preview.name;
}

export function PreviewIcon({ preview, size = 13, className }: { preview: ArtifactPreview; size?: number; className?: string }) {
  const fileKind = preview.kind === 'file' ? filePreviewKind(preview.name) : null;
  const Icon = fileKind === 'video' ? FileVideo : fileKind === 'audio' ? FileAudio : fileKind === 'archive' ? FileArchive : fileKind === 'table' ? Sheet : fileKind === 'file' ? File : preview.kind === 'html' ? FileCode2 : preview.kind === 'image' ? ImageIcon : FileText;
  return <Icon size={size} aria-hidden className={className} />;
}

/** The file itself, filling the space it's given. */
export function PreviewBody({ preview }: { preview: ArtifactPreview }) {
  if (preview.kind === 'file') return <FilePreviewView key={JSON.stringify(preview.source)} source={preview.source} name={preview.name} />;
  if (preview.kind === 'text') return <TextFileView key={`${preview.sessionId}:${preview.path}`} sessionId={preview.sessionId} path={preview.path} />;
  if (preview.kind === 'html') return <HtmlView key={`${preview.sessionId}:${preview.path}`} source={sessionFolder(preview.sessionId)} path={preview.path} />;
  if (preview.kind === 'image') return <PreviewImage key={preview.src} src={preview.src} alt={preview.alt || preview.name} className="h-full w-full object-contain p-3" />;
  return <PdfView key={preview.src} src={preview.src} name={preview.name} />;
}

/** Every file Ri holds downloads under its own name: PDFs, images, HTML and text
 * (`previewDownload`). The browser's PDF viewer has its own button too, but
 * not every browser shows that viewer (Android's Chrome gets page images),
 * and this one sits in the same place for every kind. `compact` is the icon
 * alone, for a narrow panel. */
export function PreviewDownload({ preview, compact = false }: { preview: ArtifactPreview; compact?: boolean }) {
  const cookieReady = useSessionCookieReady();
  const download = previewDownload(preview);
  if (!download) return null;
  const link = <a href={download.href} download={download.name} aria-label={compact ? `Download ${download.name}` : undefined} onClick={event => {
    if (cookieReady || event.defaultPrevented) return;
    event.preventDefault();
    void syncSessionCookie().then(() => {
      const anchor = document.createElement('a');
      anchor.href = download.href; anchor.download = download.name;
      anchor.click();
    });
  }}><Download />{!compact && 'Download'}</a>;
  if (!compact) return <Button asChild variant="ghost" size="sm" className="shrink-0">{link}</Button>;
  return <Tip label="Download"><Button asChild variant="ghost" size="icon-sm" className="shrink-0">{link}</Button></Tip>;
}

/** The destination and its explicit copy action stay together in both preview headers. */
export function PreviewSource({ preview }: { preview: ArtifactPreview }) {
  const descriptionId = useId();
  const source = previewCopySource(preview);
  if (!source) return <span className="text-xs text-muted-foreground">Embedded image</span>;
  return <FileSourceTip source={source.value} onlyWhenTextHidden>
    <button type="button" aria-label={source.label} aria-describedby={descriptionId}
      className="flex w-full min-w-0 items-center gap-3 rounded-md border border-border bg-muted/30 px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => {
        let value = source.value;
        if (source.label === 'Copy link') {
          try { value = new URL(value, window.location.href).href; } catch { /* An invalid source is still useful to copy as written. */ }
        }
        void copyText(value, source.label === 'Copy path' ? 'Path copied' : 'Link copied');
      }}>
      <span id={descriptionId} className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{source.value}</span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-foreground"><Copy size={12} aria-hidden />{source.label}</span>
    </button>
  </FileSourceTip>;
}

/** Previous and Next through the other files in the same chat, with where this one is. */
export function PreviewSteps({ index, count, onStep }: { index: number; count: number; onStep: (delta: 1 | -1) => void }) {
  if (count < 2 || index < 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Tip label="Previous" shortcut={HOTKEYS.previewPrevious.label}>
        <Button variant="ghost" size="icon-sm" aria-label="Previous preview" disabled={index === 0} onClick={() => onStep(-1)}><ChevronLeft /></Button>
      </Tip>
      <span className="min-w-12 text-center text-[11px] text-muted-foreground tabular-nums">{index + 1} of {count}</span>
      <Tip label="Next" shortcut={HOTKEYS.previewNext.label}>
        <Button variant="ghost" size="icon-sm" aria-label="Next preview" disabled={index === count - 1} onClick={() => onStep(1)}><ChevronRight /></Button>
      </Tip>
    </div>
  );
}

/**
 * Large or beside the chat: the place this file is in shows pressed, and the
 * other moves it there. Wherever it goes is where the next file opens too
 * (`preview-place.ts`). `side` is where the panel beside the chat is.
 */
export function PlaceSwitch({ place, side, onMove }: { place: PreviewPlace; side: 'left' | 'right'; onMove: () => void }) {
  const Beside = side === 'left' ? PanelLeft : PanelRight;
  const option = (value: PreviewPlace, label: string, icon: React.ReactNode) => (
    <Tip label={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={place === value}
        onClick={place === value ? undefined : onMove}
        className={cn(
          'inline-flex size-6 items-center justify-center rounded transition-colors',
          place === value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        )}
      >
        {icon}
      </button>
    </Tip>
  );
  return (
    <div role="group" aria-label="Where files open" className="flex shrink-0 items-center gap-0.5 rounded-md border border-border p-0.5">
      {option('large', 'Show large', <Expand size={13} />)}
      {option('beside', 'Show beside the chat', <Beside size={13} />)}
    </div>
  );
}

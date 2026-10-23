'use client';

import { useMemo, type ReactNode } from 'react';
import { File, FileArchive, FileAudio, FileVideo, Sheet } from 'lucide-react';
import { Tip } from '@/components/ui/tip';
import { filePreviewKind, type FilePreviewSource } from '@/lib/files/preview-types';
import { useArtifactPreview, useArtifactPreviewCard, type ArtifactPreview } from './artifact-preview-provider';

export function FilePreviewLink({ source, name, children }: { source: FilePreviewSource; name: string; children?: ReactNode }) {
  const sourceKind = source.kind;
  const sessionId = source.kind === 'session' ? source.sessionId : '';
  const path = source.kind === 'session' ? source.path : '';
  const fileName = source.kind === 'attachment' ? source.fileName : '';
  const media = source.kind === 'attachment' ? source.media : undefined;
  // Stable source fields keep card registration intact while a reply streams.
  const preview = useMemo<ArtifactPreview>(() => ({ kind: 'file', name, source: sourceKind === 'session' ? { kind: 'session', sessionId, path } : { kind: 'attachment', fileName, ...(media ? { media } : {}) } }), [sourceKind, sessionId, path, fileName, media, name]);
  const ref = useArtifactPreviewCard(preview);
  const open = useArtifactPreview();
  const kind = filePreviewKind(name);
  const Icon = kind === 'video' ? FileVideo : kind === 'audio' ? FileAudio : kind === 'table' ? Sheet : kind === 'archive' ? FileArchive : File;
  return <Tip label={source.kind === 'session' ? source.path : name} onlyWhenTextHidden>
    <button ref={ref} type="button" data-artifact-card="" aria-label={`Open file: ${name}`} onClick={event => { event.stopPropagation(); open(preview, event.currentTarget); }}
      className="inline-flex max-w-full items-baseline gap-1 text-left font-medium text-primary underline underline-offset-2"><Icon size={12} aria-hidden className="shrink-0 self-center" /><span className="wrap-anywhere">{children || name}</span></button>
  </Tip>;
}

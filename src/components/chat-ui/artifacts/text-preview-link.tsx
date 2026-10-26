'use client';

import { useMemo, type ReactNode } from 'react';
import { FileText } from 'lucide-react';
import { useArtifactPreview, useArtifactPreviewCard, type ArtifactPreview } from './artifact-preview-provider';
import { FileSourceTip } from './file-source-tip';

/** Text documents stay compact in prose and open in the chat's shared file preview. */
export function TextPreviewLink({ sessionId, path, children }: { sessionId: string; path: string; children: ReactNode }) {
  const name = path.split('/').at(-1) || path;
  const preview = useMemo<ArtifactPreview>(() => ({ kind: 'text', sessionId, path }), [sessionId, path]);
  const open = useArtifactPreview();
  const ref = useArtifactPreviewCard(preview);
  return <FileSourceTip source={path} onlyWhenTextHidden={(children || name) === path}>
    <button ref={ref} type="button" data-artifact-card="" aria-label={`Open file: ${name}`}
      onClick={event => { event.stopPropagation(); open(preview, event.currentTarget); }}
      className="inline-flex max-w-full items-baseline gap-1 text-left font-medium text-primary underline underline-offset-2"
    ><FileText size={12} aria-hidden className="shrink-0 self-center" /><span className="wrap-anywhere">{children || name}</span></button>
  </FileSourceTip>;
}

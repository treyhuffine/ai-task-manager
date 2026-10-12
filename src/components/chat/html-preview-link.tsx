'use client';

import type { ReactNode } from 'react';
import { FileCode2 } from 'lucide-react';
import { useArtifactPreview } from './artifact-preview-provider';
import { ArtifactCard } from './artifact-card';
import { HtmlView } from '@/components/executions/viewer/html-view';
import { sessionFolder } from '@/lib/folders/source';
import { usePreviewVisibility } from '@/hooks/use-preview-visibility';

export function HtmlPreviewLink({ sessionId, path, children }: { sessionId: string; path: string; children: ReactNode }) {
  const name = path.split('/').at(-1) || path;
  const open = useArtifactPreview();
  const { ref, visible } = usePreviewVisibility();
  return (
    <ArtifactCard ref={ref} name={name} aria-label={`Open HTML: ${name}`} aria-description={typeof children === 'string' ? children : undefined} icon={<FileCode2 size={13} className="shrink-0 text-muted-foreground" />} onClick={event => open({ kind: 'html', sessionId, path }, event.currentTarget)}>
      {visible && <HtmlView source={sessionFolder(sessionId)} path={path} thumbnail />}
    </ArtifactCard>
  );
}

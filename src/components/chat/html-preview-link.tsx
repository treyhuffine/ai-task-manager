'use client';

import { useMemo, type ReactNode } from 'react';
import { FileCode2 } from 'lucide-react';
import type { ArtifactPreview } from './artifact-preview-provider';
import { ArtifactCard } from './artifact-card';
import { HtmlView } from '@/components/executions/viewer/html-view';
import { sessionFolder } from '@/lib/folders/source';

export function HtmlPreviewLink({ sessionId, path, children }: { sessionId: string; path: string; children: ReactNode }) {
  const name = path.split('/').at(-1) || path;
  const preview = useMemo<ArtifactPreview>(() => ({ kind: 'html', sessionId, path }), [sessionId, path]);
  return (
    <ArtifactCard preview={preview} name={name} aria-label={`Open HTML: ${name}`} aria-description={typeof children === 'string' ? children : undefined} icon={<FileCode2 size={13} className="shrink-0 text-muted-foreground" />}>
      <HtmlView source={sessionFolder(sessionId)} path={path} thumbnail />
    </ArtifactCard>
  );
}

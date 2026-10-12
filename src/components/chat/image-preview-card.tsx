'use client';

import { ImageIcon } from 'lucide-react';
import { usePreviewVisibility } from '@/hooks/use-preview-visibility';
import { artifactImageName, imageThumbnailUrl } from '@/lib/sessions/artifact-image';
import { ArtifactCard } from './artifact-card';
import { useArtifactPreview } from './artifact-preview-provider';
import { PreviewImage } from './preview-image';

export function ImagePreviewCard({ src, alt = '', name }: { src: string; alt?: string; name?: string }) {
  const display = name || artifactImageName(src, alt);
  const open = useArtifactPreview();
  const { ref, visible } = usePreviewVisibility();
  return (
    <ArtifactCard ref={ref} name={display} aria-label={`Open image: ${display}`} icon={<ImageIcon size={13} className="shrink-0 text-muted-foreground" />} onClick={event => open({ kind: 'image', src, name: display, alt }, event.currentTarget)}>
      {visible && <PreviewImage src={imageThumbnailUrl(src)} alt={alt || display} className="block h-full w-full object-contain" />}
    </ArtifactCard>
  );
}

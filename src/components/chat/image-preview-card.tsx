'use client';

import { ImageIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { usePreviewVisibility } from '@/hooks/use-preview-visibility';
import { artifactImageName, imageThumbnailUrl } from '@/lib/sessions/artifact-image';
import { ArtifactCard } from './artifact-card';
import { useArtifactPreview } from './artifact-preview-provider';
import { PreviewImage } from './preview-image';
import { ImagePreviewDetails } from './image-preview-details';

export function ImagePreviewCard({ src, alt = '', name }: { src: string; alt?: string; name?: string }) {
  const display = name || artifactImageName(src, alt);
  const open = useArtifactPreview();
  const { ref, visible } = usePreviewVisibility();
  const [failure, setFailure] = useState<{ src: string; message: string } | null>(null);
  const onErrorChange = useCallback((message: string | undefined) => setFailure(message ? { src, message } : null), [src]);
  const error = failure?.src === src ? failure.message : undefined;
  return (
    <ArtifactCard ref={ref} name={display} details={<ImagePreviewDetails src={src} alt={alt} name={display} error={error} />} aria-label={`Open image: ${display}`} icon={<ImageIcon size={13} className="shrink-0 text-muted-foreground" />} onClick={event => open({ kind: 'image', src, name: display, alt }, event.currentTarget)}>
      {visible && <PreviewImage src={imageThumbnailUrl(src)} alt={alt || display} onErrorChange={onErrorChange} className="block h-full w-full object-contain" />}
    </ArtifactCard>
  );
}

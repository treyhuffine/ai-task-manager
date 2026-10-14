'use client';

import { useCallback, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { usePreviewVisibility } from '@/hooks/use-preview-visibility';
import { artifactImageFallback, artifactImageName, imageThumbnailUrl } from '@/lib/sessions/artifact-image';
import { ArtifactCard } from './artifact-card';
import { useArtifactPreview } from './artifact-preview-provider';
import { PreviewImage } from './preview-image';

export function ImagePreviewCard({ src, alt = '', name }: { src: string; alt?: string; name?: string }) {
  const display = name || artifactImageName(src, alt);
  const fallback = artifactImageFallback(src);
  const [failed, setFailed] = useState(false);
  const onError = useCallback(() => setFailed(true), []);
  const open = useArtifactPreview();
  const { ref, visible } = usePreviewVisibility();
  const icon = <ImageIcon size={13} className="shrink-0 text-muted-foreground" />;
  const preview = visible && <PreviewImage src={imageThumbnailUrl(src)} alt={alt || display} className="block h-full w-full object-contain" fallback={fallback} onError={onError} />;
  // A preview that cannot load still opens the image where it lives.
  if (failed && fallback) {
    return <ArtifactCard ref={ref} name={display} aria-label={`${fallback.label}: ${display}`} icon={icon} href={fallback.href}>{preview}</ArtifactCard>;
  }
  return (
    <ArtifactCard ref={ref} name={display} aria-label={`Open image: ${display}`} icon={icon} onClick={event => open({ kind: 'image', src, name: display, alt, fallback }, event.currentTarget)}>
      {preview}
    </ArtifactCard>
  );
}

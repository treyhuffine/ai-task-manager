'use client';

import { artifactImageSource } from '@/lib/sessions/artifact-image';

export function ImagePreviewDetails({ src, alt, name, error }: { src: string; alt?: string; name: string; error?: string }) {
  return (
    <span className="block space-y-1">
      <span className="block font-medium">{name}</span>
      {alt && alt !== name && <span className="block">{alt}</span>}
      <span className="block font-mono text-[11px] wrap-anywhere">Source: {artifactImageSource(src)}</span>
      {error && <span className="block">{error}</span>}
    </span>
  );
}

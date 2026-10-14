'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, ImageOff, Loader2 } from 'lucide-react';
import { getAuthToken } from '@/lib/api/client';
import { protectedImageUrl, type ImageFallback } from '@/lib/sessions/artifact-image';

export interface PreviewImageProps {
  src: string;
  alt: string;
  className?: string;
  /** Where the image can still be opened when the preview fails. */
  fallback?: ImageFallback | null;
  /** Render the fallback as a link of its own. Off inside a card, which becomes the link itself. */
  fallbackLink?: boolean;
  /** The preview failed, with the server's reason when it gave one. */
  onError?: (reason: string | null) => void;
}

export function PreviewImage(props: PreviewImageProps) {
  return protectedImageUrl(props.src) ? <ProtectedImage {...props} /> : <NativeImage {...props} />;
}

class PreviewError extends Error {
  constructor(readonly reason: string | null, status: number) {
    super(reason ?? `HTTP ${status}`);
  }
}

async function previewError(response: Response): Promise<PreviewError> {
  try {
    const body: unknown = await response.json();
    const reason = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : null;
    return new PreviewError(reason, response.status);
  } catch {
    return new PreviewError(null, response.status);
  }
}

function ProtectedImage({ src, alt, className, fallback, fallbackLink, onError }: PreviewImageProps) {
  // Duplicate references and lightboxes reuse bytes. This also works on a
  // paired browser whose session cookie has not finished syncing yet.
  const { data, error } = useQuery({
    queryKey: ['artifact-image', src],
    queryFn: async ({ signal }) => {
      const token = getAuthToken();
      const response = await fetch(src, { signal, headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw await previewError(response);
      return response.blob();
    },
    staleTime: 30_000,
    // Full-size blobs can be large. Release them on close, leaving the
    // browser's HTTP cache to handle repeat opens without another download.
    gcTime: src.includes('thumbnail=1') ? 60_000 : 0,
    retry: false,
  });
  const reason = error instanceof PreviewError ? error.reason : null;
  useEffect(() => {
    if (error) onError?.(reason);
  }, [error, reason, onError]);
  if (error) return <Unavailable reason={reason} fallback={fallback} link={fallbackLink} />;
  return data ? <BlobImage key={src} blob={data} alt={alt} className={className} /> : <span className="flex h-full items-center justify-center"><Loader2 size={16} className="animate-spin text-muted-foreground" /></span>;
}

function BlobImage({ blob, alt, className }: { blob: Blob; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;
    // Keep object URL ownership in the effect, including strict-mode cleanup.
    void Promise.resolve().then(() => {
      if (disposed) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [blob]);
  return url ? <NativeImage src={url} alt={alt} className={className} /> : null;
}

function NativeImage({ src, alt, className, fallback, fallbackLink, onError }: PreviewImageProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Unavailable fallback={fallback} link={fallbackLink} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} loading="lazy" decoding="async" onError={() => { setFailed(true); onError?.(null); }} />;
}

function Unavailable({ reason, fallback, link }: { reason?: string | null; fallback?: ImageFallback | null; link?: boolean }) {
  return (
    <span className="flex h-full flex-col items-center justify-center gap-1 px-3 text-center text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5"><ImageOff size={14} />Preview unavailable</span>
      {reason && <span className="line-clamp-3 text-[10.5px]">{reason}</span>}
      {fallback && (link
        ? <a href={fallback.href} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1 text-foreground underline-offset-2 hover:underline"><ExternalLink size={11} />{fallback.label}</a>
        : <span className="flex items-center gap-1 text-foreground"><ExternalLink size={11} />{fallback.label}</span>)}
    </span>
  );
}

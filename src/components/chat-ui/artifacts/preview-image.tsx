'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ImageOff, Loader2 } from 'lucide-react';
import { getAuthToken } from '@/lib/api/client';
import { imageResponseError, protectedImageUrl } from '@/lib/sessions/artifact-image';
import { ZoomableImage } from './zoomable-image';

/** `zoomable` draws the full-size image a preview opens to (`ZoomableImage`),
 * which lays itself out, so `className` is for the plain image only. */
type PreviewImageProps = { src: string; alt: string; className?: string; zoomable?: boolean; onErrorChange?: (message: string | undefined) => void };

export function PreviewImage(props: PreviewImageProps) {
  return protectedImageUrl(props.src) ? <ProtectedImage {...props} /> : <NativeImage key={props.src} {...props} />;
}

function ProtectedImage({ src, ...image }: PreviewImageProps) {
  // Duplicate references and lightboxes reuse bytes. This also works on a
  // paired browser whose session cookie has not finished syncing yet.
  const { data, error } = useQuery({
    queryKey: ['artifact-image', src],
    queryFn: async ({ signal }) => {
      const token = getAuthToken();
      const response = await fetch(src, { signal, headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error(await imageResponseError(response));
      return response.blob();
    },
    staleTime: 30_000,
    // Full-size blobs can be large. Release them on close, leaving the
    // browser's HTTP cache to handle repeat opens without another download.
    gcTime: src.includes('thumbnail=1') ? 60_000 : 0,
    retry: false,
  });
  const { onErrorChange } = image;
  useEffect(() => { onErrorChange?.(error?.message); }, [error, onErrorChange]);
  if (error) return <Unavailable reason={error.message} />;
  return data ? <BlobImage key={src} blob={data} {...image} /> : <span className="flex h-full items-center justify-center"><Loader2 size={16} className="animate-spin text-muted-foreground" /></span>;
}

function BlobImage({ blob, ...image }: Omit<PreviewImageProps, 'src'> & { blob: Blob }) {
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
  return url ? <NativeImage key={url} src={url} {...image} /> : null;
}

function NativeImage({ src, alt, className, zoomable, onErrorChange }: PreviewImageProps) {
  const [failed, setFailed] = useState(false);
  const reason = 'The browser could not load or decode this image.';
  if (failed) return <Unavailable reason={reason} />;
  const onLoad = () => onErrorChange?.(undefined);
  const onError = () => { setFailed(true); onErrorChange?.(reason); };
  if (zoomable) return <ZoomableImage src={src} alt={alt} onLoad={onLoad} onError={onError} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} loading="lazy" decoding="async" onLoad={onLoad} onError={onError} />;
}

function Unavailable({ reason }: { reason: string }) {
  return <span className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center text-[11px] text-muted-foreground"><span className="flex items-center gap-1.5"><ImageOff size={14} />Preview unavailable</span><span className="max-w-lg line-clamp-3 wrap-anywhere">{reason}</span></span>;
}

'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ImageOff, Loader2 } from 'lucide-react';
import { getAuthToken } from '@/lib/api/client';
import { protectedImageUrl } from '@/lib/sessions/artifact-image';

export function PreviewImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return protectedImageUrl(src) ? <ProtectedImage src={src} alt={alt} className={className} /> : <NativeImage src={src} alt={alt} className={className} />;
}

function ProtectedImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  // Duplicate references and lightboxes reuse bytes. This also works on a
  // paired browser whose session cookie has not finished syncing yet.
  const { data, error } = useQuery({
    queryKey: ['artifact-image', src],
    queryFn: async ({ signal }) => {
      const token = getAuthToken();
      const response = await fetch(src, { signal, headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.blob();
    },
    staleTime: 30_000,
    // Full-size blobs can be large. Release them on close, leaving the
    // browser's HTTP cache to handle repeat opens without another download.
    gcTime: src.includes('thumbnail=1') ? 60_000 : 0,
    retry: false,
  });
  if (error) return <Unavailable />;
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

function NativeImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Unavailable />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

function Unavailable() {
  return <span className="flex h-full items-center justify-center gap-1.5 text-[11px] text-muted-foreground"><ImageOff size={14} />Preview unavailable</span>;
}

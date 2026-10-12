'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { FileX, RefreshCw, Loader2 } from 'lucide-react';
import { apiErrorText } from '@/lib/api/client';
import { useFolderFile } from '@/hooks/use-folder';
import type { FolderSource } from '@/lib/folders/source';
import { HTML_PREVIEW_SANDBOX, htmlPreviewDocument } from '@/lib/sessions/html-preview-document';
import { FileSkeleton } from '../skeletons';
import { useQuery } from '@tanstack/react-query';
import { captureHtmlThumbnail, htmlThumbnailVersion } from '@/lib/sessions/html-thumbnail';

const subscribeToHydration = () => () => {};
const browserSnapshot = () => true;
const serverSnapshot = () => false;
const themeSnapshot = (): 'light' | 'dark' => document.documentElement.classList.contains('dark') ? 'dark' : 'light';
const serverThemeSnapshot = (): 'light' | 'dark' => 'dark';
const subscribeToTheme = (notify: () => void) => {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
};

/** One sandboxed renderer for chat artifacts and the file viewer. Loading
 * stays on the existing typed folder API, including connected-device reads. */
export function HtmlView({ source, path, thumbnail = false }: { source: FolderSource; path: string; thumbnail?: boolean }) {
  const { data, error, isFetching, refetch } = useFolderFile(source, path);
  const theme = useSyncExternalStore(subscribeToTheme, themeSnapshot, serverThemeSnapshot);
  const hydrated = useSyncExternalStore(subscribeToHydration, browserSnapshot, serverSnapshot);
  const [generation, setGeneration] = useState(0);
  const content = data?.content;
  const document = useMemo(() => !thumbnail && hydrated && typeof content === 'string' && !data?.isBinary && !data?.tooLarge
    ? htmlPreviewDocument(content, theme) : null,
  [hydrated, content, data?.isBinary, data?.tooLarge, theme, thumbnail]);

  if (error || data?.tooLarge || data?.isBinary) {
    if (thumbnail) return <span className="flex h-full items-center justify-center gap-1.5 text-[11px] text-muted-foreground"><FileX size={14} />Preview unavailable</span>;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
        <FileX size={20} />
        <p>{error ? apiErrorText(error) : data?.tooLarge ? 'This HTML file exceeds the 1 MiB preview limit.' : 'This file is not readable HTML.'}</p>
        {error && !thumbnail && <button type="button" onClick={() => void refetch()} className="underline">Try again</button>}
      </div>
    );
  }
  if (!data || !hydrated) return thumbnail ? <ThumbnailLoading /> : <FileSkeleton variant="prose" />;

  if (thumbnail && typeof content === 'string') return <HtmlThumbnail path={path} content={content} theme={theme} />;
  if (!document) return <FileSkeleton variant="prose" />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 justify-end border-b border-border px-3 py-1">
        <button
          type="button"
          disabled={isFetching}
          onClick={() => void refetch().then(() => setGeneration(value => value + 1))}
          className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw size={12} /> Reload preview
        </button>
      </div>
      <iframe
        key={`${path}:${generation}`}
        title={`HTML preview: ${path.split('/').at(-1)}`}
        sandbox={HTML_PREVIEW_SANDBOX}
        referrerPolicy="no-referrer"
        srcDoc={document}
        className="min-h-0 w-full flex-1 border-0 bg-background"
      />
    </div>
  );
}

function ThumbnailLoading() {
  return <span className="flex h-full items-center justify-center"><Loader2 size={16} className="animate-spin text-muted-foreground" /></span>;
}

function HtmlThumbnail({ content, path, theme }: { content: string; path: string; theme: 'light' | 'dark' }) {
  const version = useMemo(() => htmlThumbnailVersion(content), [content]);
  const { data, error } = useQuery({
    queryKey: ['html-thumbnail', path, theme, version],
    queryFn: ({ signal }) => captureHtmlThumbnail(content, theme, signal),
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: false,
  });
  if (error) return <span className="flex h-full items-center justify-center text-[11px] text-muted-foreground">Open to preview</span>;
  if (!data) return <ThumbnailLoading />;

  return (
    <iframe
      title={`Thumbnail: ${path.split('/').at(-1)}`}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={data}
      tabIndex={-1}
      aria-hidden="true"
      loading="lazy"
      className="pointer-events-none absolute left-0 top-0 h-[640px] w-[960px] origin-top-left scale-25 border-0 bg-background"
    />
  );
}

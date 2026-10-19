'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FileX, RefreshCw, Loader2 } from 'lucide-react';
import { useSessionCookieReady } from '@/hooks/use-session-cookie-ready';
import { useFolderFile } from '@/hooks/use-folder';
import { htmlPreviewUrl, type FolderSource } from '@/lib/folders/source';
import { HTML_PREVIEW_SANDBOX, htmlPreviewKey } from '@/lib/sessions/html-preview-document';
import { FileSkeleton } from '@/components/executions/skeletons';
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

/** One sandboxed renderer for chat artifacts and the file viewer. An opened
 * preview loads the file as its own document from the `html` route, streamed
 * into the frame by the browser, so its size never passes through Ri's page.
 * A card's thumbnail reads the source through the typed folder API instead,
 * bounded by the file viewer's cap, including connected-device reads. */
export function HtmlView({ source, path, thumbnail = false }: { source: FolderSource; path: string; thumbnail?: boolean }) {
  return thumbnail ? <HtmlCardThumbnail source={source} path={path} /> : <HtmlPreview source={source} path={path} />;
}

function HtmlPreview({ source, path }: { source: FolderSource; path: string }) {
  const theme = useSyncExternalStore(subscribeToTheme, themeSnapshot, serverThemeSnapshot);
  const hydrated = useSyncExternalStore(subscribeToHydration, browserSnapshot, serverSnapshot);
  const cookieReady = useSessionCookieReady();
  const [generation, setGeneration] = useState(0);
  const [loadedFrame, setLoadedFrame] = useState<string | null>(null);
  const src = htmlPreviewUrl(source, path, theme);
  // Reload mounts a new frame on the same URL, and the browser revalidates
  // it: an unchanged file answers 304, a rewritten one comes in fresh.
  const frame = `${generation}:${src}`;
  const loading = loadedFrame !== frame;
  const frameRef = useRef<HTMLIFrameElement>(null);
  // The served document hands Escape back (`html-preview-document.ts`).
  // Replayed on the iframe, it means what Escape means anywhere on the page:
  // the preview dialog closes, the file viewer's pane folds.
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const element = frameRef.current;
      if (!element || event.source !== element.contentWindow) return;
      const key = htmlPreviewKey(event.data);
      if (key) element.dispatchEvent(new KeyboardEvent('keydown', { ...key, bubbles: true, cancelable: true, composed: true }));
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);

  if (!hydrated || !cookieReady) return <FileSkeleton variant="prose" />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 justify-end border-b border-border px-3 py-1">
        <button
          type="button"
          onClick={() => setGeneration(value => value + 1)}
          className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Reload preview
        </button>
      </div>
      <iframe
        key={frame}
        ref={frameRef}
        title={`HTML preview: ${path.split('/').at(-1)}`}
        sandbox={HTML_PREVIEW_SANDBOX}
        referrerPolicy="no-referrer"
        src={src}
        aria-busy={loading}
        onLoad={() => setLoadedFrame(frame)}
        className="min-h-0 w-full flex-1 border-0 bg-background"
      />
    </div>
  );
}

function HtmlCardThumbnail({ source, path }: { source: FolderSource; path: string }) {
  const { data, error } = useFolderFile(source, path);
  const theme = useSyncExternalStore(subscribeToTheme, themeSnapshot, serverThemeSnapshot);
  const hydrated = useSyncExternalStore(subscribeToHydration, browserSnapshot, serverSnapshot);
  // Too large to draw small is not too large to open: the full preview streams it.
  if (data?.tooLarge) return <span className="flex h-full items-center justify-center text-[11px] text-muted-foreground">Open to preview</span>;
  if (error || data?.isBinary || data?.content === null) {
    return <span className="flex h-full items-center justify-center gap-1.5 text-[11px] text-muted-foreground"><FileX size={14} />Preview unavailable</span>;
  }
  if (!data || !hydrated) return <ThumbnailLoading />;
  return <HtmlThumbnail path={path} content={data.content} theme={theme} />;
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

'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileX } from 'lucide-react';
import { FileSkeleton } from '@/components/executions/skeletons';
import { useSessionCookieReady } from '@/hooks/use-session-cookie-ready';
import { getAuthToken } from '@/lib/api/client';
import { imageResponseError } from '@/lib/sessions/artifact-image';
import { pdfPageUrl, pdfViewerUrl } from '@/lib/sessions/reply-pdf';
import { PreviewImage } from './preview-image';

const subscribeNever = () => () => {};
/** Whether this page can show a PDF in the browser's own viewer: search,
 * zoom, selection and print come with it. Android's Chrome has no viewer,
 * and a sandboxed page (the chat UI gallery) can't host one. */
const browserViewerSnapshot = () => navigator.pdfViewerEnabled !== false && window.origin !== 'null';
const serverViewerSnapshot = () => null;

/** A PDF in the preview dialog or the file viewer. `src` serves it
 * (`src/lib/attachments/pdf-delivery.ts`). */
export function PdfView({ src, name }: { src: string; name: string }) {
  const browserViewer = useSyncExternalStore(subscribeNever, browserViewerSnapshot, serverViewerSnapshot);
  if (browserViewer === null) return <FileSkeleton variant="prose" />;
  return browserViewer ? <BrowserViewer src={src} name={name} /> : <PageImages src={src} name={name} />;
}

function authorized(range?: string): HeadersInit {
  const token = getAuthToken();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(range ? { Range: range } : {}) };
}

function Failure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
      <FileX size={20} />
      <p className="max-w-lg wrap-anywhere">{message}</p>
      <button type="button" onClick={onRetry} className="underline">Try again</button>
    </div>
  );
}

function BrowserViewer({ src, name }: { src: string; name: string }) {
  const cookieReady = useSessionCookieReady();
  // A one-byte read says whether the PDF opens before the frame loads it, so
  // a missing file or another device's file reads as a message here rather
  // than as an error page inside the viewer.
  const check = useQuery({
    queryKey: ['pdf-check', src],
    queryFn: async ({ signal }) => {
      const response = await fetch(src, { signal, headers: authorized('bytes=0-0') });
      if (!response.ok) throw new Error(await imageResponseError(response));
      await response.body?.cancel();
      return true;
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  if (check.error) return <Failure message={check.error.message} onRetry={() => void check.refetch()} />;
  if (!cookieReady || !check.data) return <FileSkeleton variant="prose" />;
  // No `sandbox` attribute: Chrome refuses to run its PDF viewer in a
  // sandboxed frame. The viewer isolates the document itself, and the
  // response keeps it a PDF in Ri's frames (pdf-delivery.ts).
  return <iframe title={`PDF: ${name}`} src={pdfViewerUrl(src, name)} referrerPolicy="no-referrer" className="h-full w-full border-0 bg-muted/30" />;
}

/** For a browser without a PDF viewer: the pages, drawn on the Home. */
function PageImages({ src, name }: { src: string; name: string }) {
  const first = useQuery({
    queryKey: ['pdf-first-page', src],
    queryFn: async ({ signal }) => {
      const response = await fetch(pdfPageUrl(src, 1), { signal, headers: authorized() });
      if (!response.ok) throw new Error(await imageResponseError(response));
      return { pages: Math.max(1, Number(response.headers.get('X-Pdf-Pages')) || 1), image: await response.blob() };
    },
    gcTime: 0,
    retry: false,
  });
  const [url, setUrl] = useState<string | null>(null);
  const [ratio, setRatio] = useState(8.5 / 11);
  const image = first.data?.image;
  useEffect(() => {
    if (!image) return;
    const objectUrl = URL.createObjectURL(image);
    // Set from a microtask, keeping URL ownership in the effect.
    void Promise.resolve().then(() => setUrl(objectUrl));
    return () => URL.revokeObjectURL(objectUrl);
  }, [image]);
  if (first.error) return <Failure message={first.error.message} onRetry={() => void first.refetch()} />;
  if (!first.data || !url) return <FileSkeleton variant="prose" />;
  return (
    <div className="h-full overflow-y-auto bg-muted/40 px-3 py-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <p className="text-center text-[11px] text-muted-foreground">Pages are shown as images here. Download the PDF to search or copy its text.</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- a blob of the first page, already fetched with this browser's token */}
        <img src={url} alt={`Page 1 of ${name}`} onLoad={event => setRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight || ratio)} className="block w-full bg-white shadow-sm" />
        {Array.from({ length: first.data.pages - 1 }, (_, index) => <LaterPage key={index + 2} src={src} page={index + 2} name={name} ratio={ratio} />)}
      </div>
    </div>
  );
}

/** A later page, fetched when it scrolls near. Shaped like the first page until then. */
function LaterPage({ src, page, name, ratio }: { src: string; page: number; name: string; ratio: number }) {
  const [near, setNear] = useState(false);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!node || near) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setNear(true); }, { rootMargin: '600px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, near]);
  return (
    <div ref={setNode} className="w-full bg-white shadow-sm" style={{ aspectRatio: String(ratio) }}>
      {near && <PreviewImage src={pdfPageUrl(src, page)} alt={`Page ${page} of ${name}`} className="block h-full w-full object-contain" />}
    </div>
  );
}

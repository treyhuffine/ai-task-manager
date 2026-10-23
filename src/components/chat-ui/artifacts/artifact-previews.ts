import { htmlDownloadUrl, sessionFolder } from '@/lib/folders/source';
import { artifactImageSource, protectedImageUrl } from '@/lib/sessions/artifact-image';
import { pdfDownloadUrl } from '@/lib/sessions/reply-pdf';
import { filePreviewUrl, type FilePreviewSource } from '@/lib/files/preview-types';

/** What a preview shows, large or beside the chat (`artifact-preview-provider.tsx`). */
export type ArtifactPreview =
  | { kind: 'file'; source: FilePreviewSource; name: string }
  | { kind: 'html'; sessionId: string; path: string }
  | { kind: 'text'; sessionId: string; path: string }
  | { kind: 'image'; src: string; name: string; alt: string }
  /** `src` serves the PDF (`reply-pdf.ts`). `source` is where it is: the path
   * the agent wrote, or the uploaded file's name. */
  | { kind: 'pdf'; src: string; name: string; source: string };

/** Where a preview's file downloads from, and under what name: the PDF
 * route's download, the HTML route's (the file as written, not the preview),
 * or an image's own URL when Ri serves it or the reply embeds it. A web
 * image stays the web's, so it has none. */
export function previewDownload(preview: ArtifactPreview): { href: string; name: string } | null {
  if (preview.kind === 'file') return { href: filePreviewUrl(preview.source, true, preview.name), name: preview.name };
  if (preview.kind === 'text') return {
    href: `/api/sessions/${encodeURIComponent(preview.sessionId)}/download?path=${encodeURIComponent(preview.path)}`,
    name: preview.path.split('/').at(-1) || preview.path,
  };
  if (preview.kind === 'pdf') return { href: pdfDownloadUrl(preview.src), name: preview.name };
  if (preview.kind === 'html') return { href: htmlDownloadUrl(sessionFolder(preview.sessionId), preview.path), name: preview.path.split('/').at(-1) || preview.path };
  if (protectedImageUrl(preview.src) || /^(data|blob):/.test(preview.src)) return { href: preview.src, name: preview.name };
  return null;
}

/** Local artifacts copy the path the agent shared. Uploaded and web files copy their URL. */
export function previewCopySource(preview: ArtifactPreview): { value: string; label: 'Copy path' | 'Copy link' } | null {
  if (preview.kind === 'file') return preview.source.kind === 'session' ? { value: preview.source.path, label: 'Copy path' } : { value: filePreviewUrl(preview.source), label: 'Copy link' };
  if (preview.kind === 'html' || preview.kind === 'text') return { value: preview.path, label: 'Copy path' };
  if (preview.kind === 'pdf') {
    const local = /^\/api\/(?:sessions|workspaces)\/[^/]+\/pdf\?/.test(preview.src) && /[?&]path=/.test(preview.src);
    return { value: local ? preview.source : preview.src, label: local ? 'Copy path' : 'Copy link' };
  }
  if (/^(?:data|blob):/.test(preview.src)) return null;
  const source = artifactImageSource(preview.src);
  return { value: source, label: source !== preview.src ? 'Copy path' : 'Copy link' };
}

/** The cards Previous and Next move between, large or beside the chat: the
 * ones in the same chat transcript (the `role="log"` around a conversation),
 * or in the same dialog or slideout. Cards in neither share the page. */
const GROUP = '[role="log"], [role="dialog"]';

/** Marks an artifact card's button (`artifact-card.tsx`). */
const CARD = '[data-artifact-card]';

export function artifactGroup(card: Element): Element | null {
  return card.closest(GROUP);
}

/** Shown on screen. The dashboard keeps a hidden copy of its layout for
 * each screen size, and a hidden copy's cards are not stops. */
export function cardShown(card: Element): boolean {
  return card.getClientRects().length > 0;
}

/** The trigger's group of cards, in transcript order (a query's document
 * order). `registered` says which cards can open. The trigger always counts
 * while it is on the page, so the preview knows its place. A transcript
 * hidden as a whole (an expanded tools panel folds the chat away) still
 * steps through its own cards: only a shown trigger leaves hidden ones out. */
export function artifactSequence(trigger: Element, registered: (card: Element) => boolean, shown: (card: Element) => boolean = cardShown): Element[] {
  const group = artifactGroup(trigger);
  const triggerShown = shown(trigger);
  return [...(group ?? trigger.ownerDocument).querySelectorAll(CARD)]
    .filter(card => card === trigger || (registered(card) && artifactGroup(card) === group && (!triggerShown || shown(card))));
}

/** Whether two cards open the same thing, to find the open preview's card
 * again after the transcript remounts under the dialog. */
export function sameArtifact(a: ArtifactPreview, b: ArtifactPreview): boolean {
  if (a.kind === 'file') return b.kind === 'file' && a.source.kind === b.source.kind && (a.source.kind === 'session' && b.source.kind === 'session' ? a.source.sessionId === b.source.sessionId && a.source.path === b.source.path : a.source.kind === 'attachment' && b.source.kind === 'attachment' && a.source.fileName === b.source.fileName);
  if (a.kind === 'html' || a.kind === 'text') return b.kind === a.kind && a.sessionId === b.sessionId && a.path === b.path;
  return (b.kind === 'image' || b.kind === 'pdf') && b.kind === a.kind && a.src === b.src;
}

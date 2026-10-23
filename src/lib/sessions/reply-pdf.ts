/**
 * PDFs in agent replies and attachments: finding the ones an agent wrote by
 * local path, and the URLs a preview reads. Browser-safe, shared with the
 * server's access check (`session-file-target.ts`).
 *
 * A PDF is served by its folder's `pdf` route or by the attachments route
 * (`src/lib/attachments/pdf-delivery.ts`). One URL names the file, and a
 * query asks for the thumbnail, a page image or a download.
 */

import { isLocalFileTarget, rewriteLocalFileReferences } from './local-file-references';

const PDF_REFERENCE_PREFIX = '#ri-pdf=';
export const PDF_PREVIEW_TAG = 'ri-pdf-preview';

export function isLocalPdfTarget(target: string): boolean {
  return isLocalFileTarget(target, 'pdf');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function pdfPreviewHref(target: string): string {
  return `${PDF_REFERENCE_PREFIX}${encodeURIComponent(target)}`;
}

/** Only our own local PDF references become preview cards. */
export function pdfPreviewTarget(href: string | undefined): string | null {
  if (!href?.startsWith(PDF_REFERENCE_PREFIX)) return null;
  try {
    const target = decodeURIComponent(href.slice(PDF_REFERENCE_PREFIX.length));
    return isLocalPdfTarget(target) ? target : null;
  } catch {
    return null;
  }
}

/** Natural PDF links and paths in a reply become preview cards. Stored replies are unchanged. */
export function rewriteLocalPdfs(markdown: string, sessionId: string | null | undefined, relativeTo?: string): string {
  if (!sessionId) return markdown;
  return rewriteLocalFileReferences(markdown, {
    extensions: 'pdf',
    relativeTo,
    render: (target, label) => `<${PDF_PREVIEW_TAG} href="${pdfPreviewHref(target)}">${escapeHtml(label || target.split('/').at(-1) || target)}</${PDF_PREVIEW_TAG}>`,
  });
}

/** A PDF an agent named in this chat, through the chat's `pdf` route. */
export function sessionPdfUrl(sessionId: string, target: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/pdf?path=${encodeURIComponent(target)}`;
}

/** An uploaded PDF, with the name its download and viewer title use. */
export function attachmentPdfUrl(url: string, name: string): string {
  return withParam(url, 'name', name);
}

function withParam(src: string, key: string, value: string): string {
  return `${src}${src.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;
}

/** What the browser's PDF viewer loads: the same URL with the file's name
 * as its last part, since the viewer titles a document by that. */
export function pdfViewerUrl(src: string, name: string): string {
  const at = src.indexOf('?');
  const [base, query] = at < 0 ? [src, ''] : [src.slice(0, at), src.slice(at)];
  return `${base}/${encodeURIComponent(name)}${query}`;
}

export const pdfThumbnailUrl = (src: string) => withParam(src, 'thumbnail', '1');
export const pdfPageUrl = (src: string, page: number) => withParam(src, 'page', String(page));
export const pdfDownloadUrl = (src: string) => withParam(src, 'download', '1');

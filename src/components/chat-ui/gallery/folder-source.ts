/** Build-only adapter for the production HTML viewer's document URL. */
export * from '../../../lib/folders/source';
import type { FolderSource } from '../../../lib/folders/source';
import { htmlPreviewDocument } from '@/lib/sessions/html-preview-document';
import { CHAT_ID, HTML_DOCUMENT } from './fixtures';

const documents = new Map<string, string>();
export function htmlPreviewUrl(source: FolderSource, path: string, theme: 'light' | 'dark') {
  if (source.kind !== 'session' || source.sessionId !== CHAT_ID || path !== 'review-plan.html') throw new Error('No gallery document exists at this path');
  let url = documents.get(theme);
  if (!url) {
    url = URL.createObjectURL(new Blob([htmlPreviewDocument(HTML_DOCUMENT, theme)], { type: 'text/html' }));
    documents.set(theme, url);
  }
  return url;
}

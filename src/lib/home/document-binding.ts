import { APP_SHORT_ID } from '@/constants/app';

/** Expectations only. These values never grant authority or replace a credential. */
export const DOCUMENT_HOME_HEADER = `x-${APP_SHORT_ID}-document-home`;
export const DOCUMENT_VIEWER_HEADER = `x-${APP_SHORT_ID}-document-viewer`;
export const DOCUMENT_AUTHOR_CHANGED = 'document_author_changed';
export const DOCUMENT_AUTHOR_CHANGED_MESSAGE = 'This sign-in changed. Your drafts are kept for their original author. Reload after signing in to the intended Home.';
export interface DocumentBinding { homeId: string; viewerId: string }
export function documentBindingMatches(expected: Partial<DocumentBinding> | null, actual: DocumentBinding) {
  return !expected || (expected.homeId === undefined && expected.viewerId === undefined) || (expected.homeId === actual.homeId && expected.viewerId === actual.viewerId);
}
export function bindingFromHeaders(headers: Headers): Partial<DocumentBinding> | null {
  if (!headers.has(DOCUMENT_HOME_HEADER) && !headers.has(DOCUMENT_VIEWER_HEADER)) return null;
  return { homeId: headers.get(DOCUMENT_HOME_HEADER) ?? undefined, viewerId: headers.get(DOCUMENT_VIEWER_HEADER) ?? undefined };
}
/** A document keeps its original audience even when another tab changes cookies. */
export function readDocumentBinding(): DocumentBinding | null {
  if (typeof document === 'undefined') return null;
  const scope = document.documentElement?.dataset;
  if (!scope) return null;
  // Root layout attributes can refresh independently. The established
  // document audience stays fixed until a new document is opened.
  if (scope.riBoundHome && scope.riBoundViewer) return { homeId: scope.riBoundHome, viewerId: scope.riBoundViewer };
  return ['team', 'space'].includes(scope.riAuthority ?? '') && scope.riHome && scope.riViewer && scope.riViewer !== 'local'
    ? { homeId: scope.riHome, viewerId: scope.riViewer } : null;
}
export function documentCredential(token: string | null | undefined) {
  return JSON.stringify([token ?? null, readDocumentBinding()]);
}

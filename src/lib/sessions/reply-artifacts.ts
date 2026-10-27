import { rewriteLocalFileReferences, isLocalFileTarget } from './local-file-references';
import { isLocalTextTarget } from './reply-text';

export const FILE_PREVIEW_TAG = 'ri-file-preview';
const PREFIX = '#ri-file=';

export function isLocalArtifactTarget(target: string): boolean {
  if (!target || /[\0\r\n]/.test(target) || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/api\/|#)/i.test(target) && !/^file:\/\//i.test(target)) return false;
  if (/^(?:www\.|(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\/)/i.test(target)) return false;
  // Authored links can name extensionless files. The shared scanner applies
  // stricter rules to inferred paths in code and prose.
  return isLocalTextTarget(target) || isLocalFileTarget(target, '[a-z0-9][a-z0-9._+-]*') || /^(?:file:\/\/|~\/|\/|\.{1,2}\/)/i.test(target);
}

export function filePreviewTarget(href?: string): string | null {
  if (!href?.startsWith(PREFIX)) return null;
  try { const path = decodeURIComponent(href.slice(PREFIX.length)); return isLocalArtifactTarget(path) ? path : null; } catch { return null; }
}

export function rewriteLocalArtifacts(markdown: string, sessionId?: string | null, relativeTo?: string): string {
  if (!sessionId) return markdown;
  return rewriteLocalFileReferences(markdown, {
    extensions: '[a-z0-9][a-z0-9._+-]*', anyFile: true, matches: isLocalArtifactTarget, relativeTo,
    preservePathText: true,
    render: (path, label) => `<${FILE_PREVIEW_TAG} href="${PREFIX}${encodeURIComponent(path)}">${(label || path.split('/').at(-1) || path).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}</${FILE_PREVIEW_TAG}>`,
  });
}

export function replyNamesFile(markdown: string, path: string): boolean {
  let named = false;
  rewriteLocalFileReferences(markdown, { extensions: '[a-z0-9][a-z0-9._+-]*', anyFile: true, matches: isLocalArtifactTarget,
    render: target => { if (target === path) named = true; return ''; } });
  return named;
}

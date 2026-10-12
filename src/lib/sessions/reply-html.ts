import { isLocalFileTarget, rewriteLocalFileReferences } from './local-file-references';

const HTML_REFERENCE_PREFIX = '#ri-html=';
export const HTML_PREVIEW_TAG = 'ri-html-preview';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function htmlPreviewReference(target: string, label?: string | null): string {
  return `<${HTML_PREVIEW_TAG} href="${htmlPreviewHref(target)}">${escapeHtml(label || target.split('/').at(-1) || target)}</${HTML_PREVIEW_TAG}>`;
}

export function isLocalHtmlTarget(target: string): boolean {
  return isLocalFileTarget(target, 'html?');
}

export function htmlPreviewHref(target: string): string {
  return `${HTML_REFERENCE_PREFIX}${encodeURIComponent(target)}`;
}

/** Only our own local HTML references become preview controls. */
export function htmlPreviewTarget(href: string | undefined): string | null {
  if (!href?.startsWith(HTML_REFERENCE_PREFIX)) return null;
  try {
    const target = decodeURIComponent(href.slice(HTML_REFERENCE_PREFIX.length));
    return isLocalHtmlTarget(target) ? target : null;
  } catch {
    return null;
  }
}

/** Natural HTML links/paths and visualize markers share one preview action. */
export function rewriteLocalHtml(markdown: string, sessionId: string | null | undefined): string {
  if (!sessionId) return markdown;
  return rewriteLocalFileReferences(markdown, {
    extensions: 'html?',
    render: htmlPreviewReference,
    marker: {
      pattern: /\uE200visualize\uE202([\s\S]*?)\uE201/g,
      target: match => {
        try {
          const value = JSON.parse(match[1]);
          return typeof value?.path === 'string' ? value.path : null;
        } catch {
          return null;
        }
      },
    },
  });
}

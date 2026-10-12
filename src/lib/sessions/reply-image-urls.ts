import { isLocalFileTarget, markdownLabel, rewriteLocalFileReferences } from './local-file-references';

const IMAGE_EXTENSIONS = 'png|jpe?g|gif|webp|avif|svg|heic|heif|bmp|ico';

export function replyImageUrl(sessionId: string, target: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/reply-image?path=${encodeURIComponent(target)}`;
}

export function isLocalImageTarget(target: string): boolean {
  return isLocalFileTarget(target, IMAGE_EXTENSIONS);
}

/** Show natural image references through the authenticated chat image route. */
export function rewriteLocalImages(markdown: string, sessionId: string | null | undefined): string {
  if (!sessionId) return markdown;
  return rewriteLocalFileReferences(markdown, {
    extensions: IMAGE_EXTENSIONS,
    render: (target, label, title) => {
      const alt = markdownLabel(label || target.split('/').at(-1) || target);
      const caption = title ? ` "${title.replace(/[\\"]/g, '\\$&').replace(/\n/g, ' ')}"` : '';
      return `![${alt}](${replyImageUrl(sessionId, target)}${caption})`;
    },
  });
}

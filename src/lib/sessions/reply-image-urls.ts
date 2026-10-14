import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Definition, Nodes } from 'mdast';
import { githubImageLink, githubImageSource } from '@/lib/github/image-urls';
import { applyReplacements, isLocalFileTarget, labelText, markdownLabel, rewriteLocalFileReferences, type Replacement } from './local-file-references';

const IMAGE_EXTENSIONS = 'png|jpe?g|gif|webp|avif|svg|heic|heif|bmp|ico';

export function replyImageUrl(sessionId: string, target: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/reply-image?path=${encodeURIComponent(target)}`;
}

export function isLocalImageTarget(target: string): boolean {
  return isLocalFileTarget(target, IMAGE_EXTENSIONS);
}

function imageMarkdown(sessionId: string, target: string, alt: string, title?: string | null): string {
  const caption = title ? ` "${title.replace(/[\\"]/g, '\\$&').replace(/\n/g, ' ')}"` : '';
  return `![${markdownLabel(alt)}](${replyImageUrl(sessionId, target)}${caption})`;
}

/** Show natural image references through the authenticated chat image route. */
export function rewriteLocalImages(markdown: string, sessionId: string | null | undefined): string {
  if (!sessionId) return markdown;
  return rewriteLocalFileReferences(markdown, {
    extensions: IMAGE_EXTENSIONS,
    render: (target, label, title) => imageMarkdown(sessionId, target, label || target.split('/').at(-1) || target, title),
  });
}

/**
 * Show images in GitHub repositories through the same route. A Markdown
 * image with a repository address is one by declaration, whatever its
 * name. A plain link becomes one only when it can mean nothing but the
 * bytes (`githubImageLink`). Code, and every other address, stays as written.
 */
export function rewriteGithubImages(markdown: string, sessionId: string | null | undefined): string {
  if (!sessionId || !/github(?:usercontent)?\.com\//i.test(markdown)) return markdown;
  const tree = fromMarkdown(markdown);
  const definitions = new Map<string, Definition>();
  const replacements: Replacement[] = [];

  function collectDefinitions(node: Nodes) {
    if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
    if ('children' in node) node.children.forEach(collectDefinitions);
  }
  collectDefinitions(tree);

  function visit(node: Nodes) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    if (node.type === 'image' || node.type === 'imageReference') {
      const target = 'url' in node ? node : definitions.get(node.identifier);
      const source = target && githubImageSource(target.url);
      if (target && source) replacements.push({ start, end, text: imageMarkdown(sessionId!, target.url, node.alt || source.name, target.title) });
      return;
    }
    if (node.type === 'link' || node.type === 'linkReference') {
      const target = 'url' in node ? node : definitions.get(node.identifier);
      const source = target && githubImageLink(target.url);
      if (target && source) {
        const label = labelText(node);
        replacements.push({ start, end, text: imageMarkdown(sessionId!, target.url, label && label !== target.url ? label : source.name, target.title) });
      }
      return;
    }
    if ('children' in node) node.children.forEach(visit);
  }
  visit(tree);
  return applyReplacements(markdown, replacements);
}

/** Every image an agent can show in a reply: local files and GitHub repository files. */
export function rewriteReplyImages(markdown: string, sessionId: string | null | undefined): string {
  return rewriteGithubImages(rewriteLocalImages(markdown, sessionId), sessionId);
}

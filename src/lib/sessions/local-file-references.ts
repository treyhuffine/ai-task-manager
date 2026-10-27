/**
 * Find local file references agents write naturally. Shared by image previews
 * and interactive HTML previews, without changing the stored reply.
 *
 * Use Markdown's syntax tree to keep code blocks, web links, and link targets
 * out of the path scan. Replace source ranges, so the rest of the reply stays
 * exactly as written. This changes presentation only, never the saved message.
 */

import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Definition, Nodes } from 'mdast';

// Inferred files need a directory and extension. An authored Markdown link
// can still name a bare filename or an extensionless file.
const PATH_PREFIX = String.raw`(?:file:\/\/|~\/|\/(?!\/)|\.{1,2}\/|[\w.-]+\/)`;
const STANDALONE_PATH = new RegExp(String.raw`^(?:${PATH_PREFIX}|[^\s/]+$)`, 'i');

/** Whether a target is a local path with one of the requested extensions. */
export function isLocalFileTarget(target: string, extensions: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^file:\/\//i.test(target)) return false;
  if (target.startsWith('//') || target.startsWith('/api/') || target.startsWith('#')) return false;
  // Scheme-less web addresses are still links. A domain-shaped local
  // directory can be named explicitly with ./ instead.
  if (/^(?:www\.|(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\/)/i.test(target)) return false;
  const path = target.replace(/^file:\/\//i, '').split(/[?#]/)[0] ?? '';
  return new RegExp(`\\.(?:${extensions})$`, 'i').test(path);
}

/** Syntax only: never probe the filesystem while rendering a message. */
function isInferredFileTarget(target: string): boolean {
  const file = target.split(/[?#]/)[0].replace(/:\d+(?::\d+)?$/, '');
  return file.replace(/^file:\/\//i, '').includes('/')
    && isLocalFileTarget(file, '[a-z0-9][a-z0-9._+-]*');
}

interface Replacement {
  start: number;
  end: number;
  text: string;
}

function labelText(node: Nodes): string {
  if ('value' in node) return node.value;
  if ('children' in node) return node.children.map(labelText).join('');
  return '';
}

export function markdownLabel(label: string): string {
  return label.replace(/[\\\[\]]/g, '\\$&').replace(/\n/g, ' ');
}

/** Streamdown escapes Markdown punctuation in literal tags. Entities keep
 * that punctuation literal inside inline code too, where escapes stay visible. */
export function escapeFilePreviewLabel(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/[\\`*_~[\]|]/g, character => `&#${character.charCodeAt(0)};`);
}

/** A document's relative links refer to its own directory, not to the chat's root. */
export function resolveFileReference(target: string, relativeTo?: string): string {
  if (!relativeTo || /^(?:[a-z][a-z0-9+.-]*:|\/|~\/|#)/i.test(target)) return target;
  if (/^file:\/\//i.test(relativeTo)) return new URL(target, relativeTo).href;
  const directory = relativeTo.slice(0, relativeTo.lastIndexOf('/') + 1);
  const absolute = directory.startsWith('/');
  const parts: string[] = [];
  for (const part of `${directory}${target}`.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..' && parts.length && parts.at(-1) !== '..' && parts.at(-1) !== '~') parts.pop();
    else if (part !== '..' || !absolute) parts.push(part);
  }
  return `${absolute ? '/' : ''}${parts.join('/')}`;
}

interface ReferenceOptions {
  /** A trusted extension pattern, never user input. */
  extensions: string;
  render: (target: string, label?: string | null, title?: string | null) => string;
  /** A format may accept conventional suffixes such as source.ts:12. */
  matches?: (target: string) => boolean;
  relativeTo?: string;
  basenames?: string;
  anyFile?: boolean;
  /** Text controls keep the original path, quotes and inline code styling. */
  preservePathText?: boolean;
  /** Non-Markdown artifact references, such as the visualize output marker. */
  marker?: { pattern: RegExp; target: (match: RegExpMatchArray) => string | null };
}

export function rewriteLocalFileReferences(markdown: string, options: ReferenceOptions): string {
  const { extensions, marker } = options;
  const render: ReferenceOptions['render'] = (target, label, title) => options.render(resolveFileReference(target, options.relativeTo), label, title);
  if (!options.anyFile && !new RegExp(`\\.(?:${extensions})\\b${options.basenames ? `|\\b(?:${options.basenames})\\b` : ''}`, 'i').test(markdown)) return markdown;
  const ext = options.anyFile ? '' : `(?:\\.(?:${extensions})${options.basenames ? `|(?:${options.basenames})` : ''})`;
  const quotedPath = new RegExp(String.raw`"(${PATH_PREFIX}[^"\n]*?${ext})"|'(${PATH_PREFIX}[^'\n]*?${ext})'`, 'gi');
  const barePath = options.anyFile
    ? new RegExp(String.raw`(^|[\s("'<>])(${PATH_PREFIX}[^\s"'\x60<>\[\]{}]+)`, 'gi')
    : new RegExp(String.raw`(^|[\s("'<>])(${PATH_PREFIX}[^\s"'\x60<>\[\]{}]*?${ext})(?![\w/]|\.[\w])`, 'gi');
  const matchesTarget = options.matches ?? ((target: string) => isLocalFileTarget(target, extensions));
  const matchesInferredTarget = (target: string) => isInferredFileTarget(target) && matchesTarget(target);
  const tree = fromMarkdown(markdown);
  const definitions = new Map<string, Definition>();
  const replacements: Replacement[] = [];
  const markerRanges: { start: number; end: number }[] = [];

  function collectDefinitions(node: Nodes) {
    if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
    if ('children' in node) node.children.forEach(collectDefinitions);
  }
  collectDefinitions(tree);

  if (marker) {
    const protectedRanges: { start: number; end: number }[] = [];
    function protectCode(node: Nodes) {
      if (['code', 'inlineCode', 'html', 'link', 'image'].includes(node.type)) {
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        if (start !== undefined && end !== undefined) protectedRanges.push({ start, end });
      } else if ('children' in node) node.children.forEach(protectCode);
    }
    protectCode(tree);
    for (const match of markdown.matchAll(marker.pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      markerRanges.push({ start, end });
      if (protectedRanges.some(range => start < range.end && end > range.start)) continue;
      const target = marker.target(match);
      if (target && matchesTarget(target)) replacements.push({ start, end, text: render(target) });
    }
  }

  function visit(node: Nodes) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    if (markerRanges.some(range => start >= range.start && end <= range.end)) return;

    if (node.type === 'image' || node.type === 'link' || node.type === 'imageReference' || node.type === 'linkReference') {
      const target = 'url' in node ? node : definitions.get(node.identifier);
      if (target && matchesTarget(target.url)) {
        replacements.push({ start, end, text: render(target.url, 'alt' in node ? node.alt : labelText(node), target.title) });
      }
      // Never scan a web link's label or an image's alt text for local paths.
      return;
    }

    if (node.type === 'inlineCode') {
      // Agents routinely put a single file path in backticks. Code examples
      // containing more than that path stay code, as do fenced/indented blocks.
      const target = node.value.trim();
      if (STANDALONE_PATH.test(target) && matchesInferredTarget(target)) {
        const control = render(target, options.preservePathText ? node.value : undefined);
        replacements.push({ start, end, text: options.preservePathText ? `<code>${control}</code>` : control });
      }
      return;
    }

    if (node.type === 'text') {
      const source = markdown.slice(start, end);
      const paths: Replacement[] = [];
      for (const match of source.matchAll(quotedPath)) {
        const target = match[1] ?? match[2];
        if (!matchesInferredTarget(target)) continue;
        const at = start + match.index;
        const until = at + match[0].length;
        if (markerRanges.some(range => at < range.end && until > range.start)) continue;
        const control = render(target, options.preservePathText ? target : undefined);
        const quote = match[0][0];
        paths.push({ start: at, end: until, text: options.preservePathText ? `${quote}${control}${quote}` : control });
      }
      for (const match of source.matchAll(barePath)) {
        const target = options.anyFile ? match[2].replace(/[.,;:!?\)]+$/, '') : match[2];
        if (!matchesInferredTarget(target)) continue;
        const at = start + match.index + match[1].length;
        if (markerRanges.some(range => at < range.end && at + target.length > range.start)) continue;
        if (paths.some((p) => at >= p.start && at < p.end)) continue;
        paths.push({ start: at, end: at + target.length, text: render(target, options.preservePathText ? target : undefined) });
      }
      replacements.push(...paths);
      return;
    }

    if ('children' in node) node.children.forEach(visit);
  }
  visit(tree);

  // Source offsets refer to the original message. Apply from the end so an
  // earlier replacement never shifts a later one's range.
  let rewritten = markdown;
  for (const { start, end, text } of replacements.sort((a, b) => b.start - a.start)) {
    rewritten = rewritten.slice(0, start) + text + rewritten.slice(end);
  }
  return rewritten;
}

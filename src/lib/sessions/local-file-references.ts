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

// Bare filenames need an explicit Markdown link or inline code. In prose,
// require a path prefix or a directory, so "saved shot.png" stays prose.
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

interface ReferenceOptions {
  /** A trusted extension pattern, never user input. */
  extensions: string;
  render: (target: string, label?: string | null, title?: string | null) => string;
  /** Non-Markdown artifact references, such as the visualize output marker. */
  marker?: { pattern: RegExp; target: (match: RegExpMatchArray) => string | null };
}

export function rewriteLocalFileReferences(markdown: string, options: ReferenceOptions): string {
  const { extensions, render, marker } = options;
  if (!new RegExp(`\\.(?:${extensions})\\b`, 'i').test(markdown)) return markdown;
  const ext = `\\.(?:${extensions})`;
  const quotedPath = new RegExp(String.raw`"(${PATH_PREFIX}[^"\n]*?${ext})"|'(${PATH_PREFIX}[^'\n]*?${ext})'`, 'gi');
  const barePath = new RegExp(String.raw`(^|[\s("'<>])(${PATH_PREFIX}[^\s"'\x60<>\[\]{}]*?${ext})(?![\w/]|\.[\w])`, 'gi');
  const matchesTarget = (target: string) => isLocalFileTarget(target, extensions);
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
      if (STANDALONE_PATH.test(target) && matchesTarget(target)) {
        replacements.push({ start, end, text: render(target) });
      }
      return;
    }

    if (node.type === 'text') {
      const source = markdown.slice(start, end);
      const paths: Replacement[] = [];
      for (const match of source.matchAll(quotedPath)) {
        const target = match[1] ?? match[2];
        if (!matchesTarget(target)) continue;
        const at = start + match.index;
        const until = at + match[0].length;
        if (markerRanges.some(range => at < range.end && until > range.start)) continue;
        paths.push({ start: at, end: until, text: render(target) });
      }
      for (const match of source.matchAll(barePath)) {
        const target = match[2];
        if (!matchesTarget(target)) continue;
        const at = start + match.index + match[1].length;
        if (markerRanges.some(range => at < range.end && at + target.length > range.start)) continue;
        if (paths.some((p) => at >= p.start && at < p.end)) continue;
        paths.push({ start: at, end: at + target.length, text: render(target) });
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

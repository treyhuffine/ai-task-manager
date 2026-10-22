/**
 * An agent's reply as notification text. Replies are Markdown written for the chat, where entity
 * markers render as chips. A notification is plain text, so this keeps the reply's shape
 * (paragraphs, lists, code) and drops the syntax, names each `[[task:<id>]]` the way its chip
 * would. A channel takes what it can carry: one line of it for an OS notification, or all of it
 * split into messages for a chat app, each break falling where a reader would pause.
 */
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { List, Nodes, PhrasingContent } from 'mdast';

/**
 * The most a notification carries. It sits past every agent reply on record (the longest was
 * 24,838 characters), so a reply arrives whole. It only stops a runaway reply, a pasted log say,
 * from arriving as dozens of messages.
 */
export const FULL_BODY_MAX = 50_000;

/**
 * The one-line body OS notifications (desktop, web push) carry. The OS shows what fits on screen
 * and trims the rest itself, more on an expanded phone notification than on a desktop banner.
 * This is what both transports hold whole: the desktop app takes 1,000 characters, and at 3 bytes
 * a character at most, it sits well inside web push's 4 KB payload.
 */
export const LINE_BODY_MAX = 1000;

const ENTITY_MARKER = /\[\[(task|note|area|deck|execution|file|scratchpad):([^\]\n]*)\]\]/g;

export type EntityMarkerKind = 'task' | 'note' | 'area' | 'deck' | 'execution' | 'file' | 'scratchpad';

/** What a marker reads as in plain text: the entity's name, or null to drop it. */
export type NameEntity = (kind: EntityMarkerKind, id: string) => string | null | undefined;

/**
 * A Markdown reply as plain text that still reads like the reply: blocks stay apart, lists keep
 * their bullets, code keeps its lines, and links keep a web address a reader can tap.
 */
export function messageText(markdown: string, nameEntity: NameEntity = () => null): string {
  const named = markdown.replace(ENTITY_MARKER, (_, kind: EntityMarkerKind, id: string) =>
    escapeMarkdown(nameEntity(kind, id.trim())?.trim() ?? ''),
  );
  const text = blocks(fromMarkdown(named).children, '\n\n');
  return text
    // Keep line structure; drop control characters a message can't show.
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
    .replace(/[ \u00a0]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The same text on one line, for channels that show a line or two. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Fit text to `max` as counted by `measure` (a length, additive over concatenation). Text that
 * fits comes back unchanged. Longer text is cut at the last paragraph, line, sentence or word
 * that fits, close enough to the limit that little room is lost, and ends with an ellipsis.
 */
export function fitText(text: string, max: number, measure: (s: string) => number = (s) => s.length): string {
  if (measure(text) <= max) return text;
  const room = longestFit(text, (p) => measure(p + '…') <= max);
  const kept = text.slice(0, cleanCut(text, room)).trimEnd();
  if (!kept) return '';
  // After a full stop, set the ellipsis apart when there's room ("Done. …", not "Done.…").
  const spaced = `${kept} …`;
  return /[.!?:;)\]]$/.test(kept) && measure(spaced) <= max ? spaced : `${kept}…`;
}

/**
 * Split text into parts that each fit `max` as counted by `measure` (additive, like `fitText`'s),
 * losing nothing. Each break falls at the last paragraph, line, sentence or word that fits.
 */
export function splitText(text: string, max: number, measure: (s: string) => number = (s) => s.length): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest && measure(rest) > max) {
    const room = longestFit(rest, (p) => measure(p) <= max);
    // Always move forward, even past a single character too wide to fit on its own.
    const at = cleanCut(rest, room) || (rest.codePointAt(0)! > 0xffff ? 2 : 1);
    const part = rest.slice(0, at).trimEnd();
    if (part) parts.push(part);
    rest = rest.slice(at).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** The length of the longest prefix of `text` that `fits`, never splitting a surrogate pair. */
function longestFit(text: string, fits: (prefix: string) => boolean): number {
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(prefix(text, mid))) lo = mid;
    else hi = mid - 1;
  }
  return prefix(text, lo).length;
}

/** The first `n` UTF-16 units, never splitting a surrogate pair. */
function prefix(text: string, n: number): string {
  const code = text.charCodeAt(n - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? n - 1 : n);
}

/**
 * Where to cut `text` so it keeps at most `n` units: the latest paragraph, line, sentence or word
 * boundary in the last 40% of that room, else `n` itself (0 when `n` is). A boundary at `n` counts, so a room that
 * ends a word, followed by a space, keeps that word.
 */
function cleanCut(text: string, n: number): number {
  const floor = Math.floor(n * 0.6);
  const ahead = text.slice(0, n + 1);
  const sentenceEnd = [...ahead.matchAll(/[.!?](?=\s)/g)].at(-1);
  const candidates = [
    text.lastIndexOf('\n\n', n),
    text.lastIndexOf('\n', n),
    sentenceEnd ? sentenceEnd.index + 1 : -1,
    ahead.search(/\s\S*$/),
  ];
  return candidates.find((i) => i >= floor && i > 0 && i <= n) ?? n;
}

/** Backslash-escape a name so Markdown keeps it literal. */
function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&');
}

function blocks(nodes: readonly Nodes[], separator: string): string {
  return nodes.map(block).filter((b) => b.trim() !== '').join(separator);
}

function block(node: Nodes): string {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return inline(node.children);
    case 'code':
    case 'html':
      return node.value;
    case 'blockquote':
      return blocks(node.children, '\n\n').replace(/^/gm, '> ');
    case 'list':
      return list(node);
    case 'thematicBreak':
    case 'definition':
      return '';
    default:
      return 'children' in node ? blocks(node.children as Nodes[], '\n\n') : 'value' in node ? String(node.value) : '';
  }
}

function list(node: List): string {
  const start = node.start ?? 1;
  return node.children
    .map((item, i) => {
      const bullet = node.ordered ? `${start + i}. ` : '• ';
      const body = blocks(item.children, item.spread ? '\n\n' : '\n');
      return bullet + body.replace(/\n(?=.)/g, `\n${' '.repeat(bullet.length)}`);
    })
    .join(node.spread ? '\n\n' : '\n');
}

function inline(nodes: readonly PhrasingContent[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'inlineCode':
        case 'html':
          return node.value;
        case 'break':
          return '\n';
        case 'emphasis':
        case 'strong':
        case 'delete':
        case 'linkReference':
          return inline(node.children);
        case 'link': {
          const label = inline(node.children);
          // A web address is worth keeping where a reader can tap it. App paths and local files aren't.
          if (!/^https?:\/\//i.test(node.url) || label.includes(node.url)) return label;
          return label.trim() ? `${label} (${node.url})` : node.url;
        }
        case 'image':
        case 'imageReference':
          return node.alt ?? '';
        default:
          return '';
      }
    })
    .join('');
}

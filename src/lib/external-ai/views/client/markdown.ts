/**
 * Markdown as Ri's view draws a task or note body. It builds DOM nodes and
 * never HTML, so nothing in a body runs as code or markup. It covers what
 * Ri's editor writes (headings, lists and task lists, quotes, code, tables,
 * emphasis and links) plus Ri's `[[task:id]]` and `[[note:id]]` links, which
 * open the item in the view. Images can't load here (the page reaches no
 * network), so they show as their description.
 * Browser code: bundled into the view by `pnpm mcp-views:build`.
 */
import { h } from './dom';

export interface MarkdownOptions {
  /** Titles for the task and note links the body holds, by id. */
  links: Record<string, { type: 'task' | 'note'; title: string }>;
  openItem(type: 'task' | 'note', id: string): void;
  openLink(url: string): void;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line);
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim());
}

function indentOf(line: string): number {
  return line.replace(/\t/g, '    ').match(/^ */)![0].length;
}

/** Draws a markdown body. */
export function markdown(source: string, options: MarkdownOptions): DocumentFragment {
  const out = document.createDocumentFragment();
  for (const node of blocks(source.replace(/\r\n?/g, '\n').split('\n'), options)) out.append(node);
  return out;
}

function blocks(lines: string[], options: MarkdownOptions): Node[] {
  const nodes: Node[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
      i++;
      nodes.push(h('pre', {}, h('code', {}, code.join('\n'))));
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      nodes.push(h(level === 1 ? 'h2' : level === 2 ? 'h3' : 'h4', {}, ...inline(heading[2], options)));
      i++;
      continue;
    }

    if (RULE.test(line)) { nodes.push(h('hr')); i++; continue; }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && lines[i].trim() && (QUOTE.test(lines[i]) || !startsBlock(lines[i]))) quoted.push(lines[i++].replace(QUOTE, ''));
      nodes.push(h('blockquote', {}, ...blocks(quoted, options)));
      continue;
    }

    // A table's rule row has a cell for each heading, as GFM asks, so a line of dashes under text stays a rule.
    if (line.includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]) && cells(lines[i + 1]).length === cells(line).length) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      nodes.push(h('div', { className: 'md-table' }, h('table', {},
        h('thead', {}, h('tr', {}, ...head.map(cell => h('th', {}, ...inline(cell, options))))),
        h('tbody', {}, ...rows.map(row => h('tr', {}, ...head.map((_, index) => h('td', {}, ...inline(row[index] ?? '', options)))))),
      )));
      continue;
    }

    if (ITEM.test(line)) {
      const start = i;
      const base = indentOf(line);
      i++;
      // The list runs on through its items, their indented lines, and blank lines between them.
      while (i < lines.length) {
        const next = lines[i];
        if (next.trim()) {
          const item = ITEM.exec(next);
          if (item ? indentOf(next) < base : indentOf(next) <= base) break;
          i++;
          continue;
        }
        const after = lines.slice(i + 1).find(candidate => candidate.trim());
        if (!after || !(ITEM.test(after) ? indentOf(after) >= base : indentOf(after) > base)) break;
        i++;
      }
      nodes.push(list(lines.slice(start, i), base, options));
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !(paragraph.length && startsBlock(lines[i]))) paragraph.push(lines[i++]);
    nodes.push(h('p', {}, ...inline(paragraph.join('\n'), options)));
  }
  return nodes;
}

function list(lines: string[], base: number, options: MarkdownOptions): HTMLElement {
  const first = ITEM.exec(lines[0])!;
  const ordered = /\d/.test(first[2]);
  const items: Array<{ text: string; rest: string[] }> = [];
  for (const line of lines) {
    const item = ITEM.exec(line);
    if (item && indentOf(line) <= base + 1) items.push({ text: item[3], rest: [] });
    else items[items.length - 1]?.rest.push(line.slice(Math.min(indentOf(line), base + first[2].length + 1)));
  }
  const element = ordered ? h('ol', { className: 'md-list', start: Number.parseInt(first[2], 10) === 1 ? undefined : Number.parseInt(first[2], 10) }) : h('ul', { className: 'md-list' });
  for (const { text, rest } of items) {
    const task = /^\[([ xX])\]\s+(.*)$/.exec(text);
    const li = h('li', task ? { className: 'md-task' } : {});
    if (task) {
      const done = task[1] !== ' ';
      li.append(h('span', { className: `md-box${done ? ' on' : ''}`, role: 'img', 'aria-label': done ? 'Done' : 'Not done' }, done ? '✓' : ''), h('span', {}, ...inline(task[2], options)));
    } else {
      li.append(...inline(text, options));
    }
    const nested = blocks(rest, options);
    if (nested.length) li.append(...nested);
    element.append(li);
  }
  return element;
}

// ─── Inline ───────────────────────────────────────────────────

interface Rule { pattern: RegExp; draw(match: RegExpExecArray, options: MarkdownOptions): Node | Node[] }

const SAFE_URL = /^(https?:|mailto:)/i;

function link(label: Node[], url: string, options: MarkdownOptions): Node | Node[] {
  if (!SAFE_URL.test(url)) return label;
  return h('a', { href: url, className: 'md-link', onClick: (event: Event) => { event.preventDefault(); options.openLink(url); } }, ...label);
}

const RULES: Rule[] = [
  { pattern: /\\([\\`*_{}[\]()#+\-.!~|>])/, draw: match => document.createTextNode(match[1]) },
  { pattern: /(`+)([\s\S]*?[^`])\1(?!`)/, draw: match => h('code', {}, match[2].trim()) },
  {
    pattern: /\[\[(task|note|file):([^\]]+)\]\]/,
    draw: (match, options) => {
      const [, type, ref] = match;
      if (type === 'file') return h('span', { className: 'chip' }, `File ${ref.replace(/^.*\//, '')}`);
      const known = options.links[ref];
      if (!known) return h('span', { className: 'chip' }, type === 'task' ? 'A task in Ri' : 'A note in Ri');
      return h('button', { type: 'button', className: 'md-ref', onClick: () => options.openItem(known.type, ref) }, known.title);
    },
  },
  { pattern: /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/, draw: match => h('span', { className: 'chip' }, match[1] ? `Image: ${match[1]}` : 'Image') },
  { pattern: /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/, draw: (match, options) => link(inline(match[1], options), match[2], options) },
  { pattern: /<((?:https?:\/\/|mailto:)[^>\s]+)>/, draw: (match, options) => link([document.createTextNode(match[1])], match[1], options) },
  { pattern: /https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"*_]/, draw: (match, options) => link([document.createTextNode(match[0])], match[0], options) },
  // Strong never holds its own marker: the nearest pair wins, as in CommonMark.
  { pattern: /\*\*(?=\S)((?:(?!\*\*)[\s\S])*?\S)\*\*/, draw: (match, options) => h('strong', {}, ...inline(match[1], options)) },
  // Underscores only at word edges, so names like snake_case or __init__ stay as written.
  { pattern: /(?<![\w_])__(?=[^\s_])((?:(?!__)[\s\S])*?[^\s_])__(?![\w_])/, draw: (match, options) => h('strong', {}, ...inline(match[1], options)) },
  { pattern: /~~(?=\S)([\s\S]*?\S)~~/, draw: (match, options) => h('s', {}, ...inline(match[1], options)) },
  { pattern: /(?<![\w*])\*(?=[^\s*])([\s\S]*?[^\s*])\*(?![\w*])/, draw: (match, options) => h('em', {}, ...inline(match[1], options)) },
  { pattern: /(?<![\w_])_(?=[^\s_])([\s\S]*?[^\s_])_(?![\w_])/, draw: (match, options) => h('em', {}, ...inline(match[1], options)) },
  { pattern: / {2,}\n|\\\n/, draw: () => h('br') },
];

function inline(text: string, options: MarkdownOptions): Node[] {
  const nodes: Node[] = [];
  let rest = text;
  while (rest) {
    let best: { match: RegExpExecArray; rule: Rule } | null = null;
    for (const rule of RULES) {
      const match = rule.pattern.exec(rest);
      if (match && (!best || match.index < best.match.index)) best = { match, rule };
    }
    if (!best) { nodes.push(document.createTextNode(rest)); break; }
    if (best.match.index) nodes.push(document.createTextNode(rest.slice(0, best.match.index)));
    const drawn = best.rule.draw(best.match, options);
    if (Array.isArray(drawn)) nodes.push(...drawn); else nodes.push(drawn);
    rest = rest.slice(best.match.index + best.match[0].length);
  }
  return nodes;
}

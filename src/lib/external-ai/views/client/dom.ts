/**
 * Small DOM helpers for Ri's view. No framework: the page is drawn again from
 * state on every change, and the few fields a person types into are kept
 * across draws by whoever owns them.
 * Browser code: bundled into the view by `pnpm mcp-views:build`.
 */

export type Child = Node | string | null | false | undefined;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (name.startsWith('on') && typeof value === 'function') element.addEventListener(name.slice(2).toLowerCase(), value as EventListener);
    else if (name === 'className') element.className = String(value);
    else element.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) if (child) element.append(child);
  return element;
}

const SVG = 'http://www.w3.org/2000/svg';

export function icon(paths: readonly string[], size = 14): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** Lucide's paths, so the view's icons match Ri's. */
export const ICONS = {
  check: ['M20 6 9 17l-5-5'],
  open: ['M7 17 17 7', 'M8 7h9v9'],
  addToMessage: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', 'M12 7v6', 'M9 10h6'],
  back: ['m15 18-6-6 6-6'],
  next: ['m9 18 6-6-6-6'],
  plus: ['M5 12h14', 'M12 5v14'],
  search: ['m21 21-4.34-4.34', 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z'],
  video: ['m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5', 'M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z'],
  pencil: ['M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z', 'm15 5 4 4'],
} as const;

/** A button that only shows an icon, with the words a screen reader needs. */
export function iconButton(label: string, paths: readonly string[], onClick: () => void, className = 'icon-button'): HTMLButtonElement {
  return h('button', { type: 'button', className, 'aria-label': label, onClick }, icon(paths, 14));
}

/** Items with a quiet dot between them, as Ri's meta lines read. */
export function dotted(nodes: Node[]): Node[] {
  return nodes.flatMap((node, index) => (index ? [h('span', { className: 'dot', 'aria-hidden': 'true' }, '·'), node] : [node]));
}

/** A text field that reads Enter itself: a sandboxed frame may not let a form submit at all. */
export function field(label: string, onEnter: () => void, onEscape?: () => void): HTMLInputElement {
  return h('input', {
    className: 'field', type: 'text', placeholder: label, 'aria-label': label, autocomplete: 'off',
    onKeydown: (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); onEnter(); }
      if (event.key === 'Escape' && onEscape) { event.preventDefault(); onEscape(); }
    },
  });
}

/** Sizes a growing text area to what's written in it. CSS caps the height. */
export function fit(area: HTMLTextAreaElement): void {
  if (!area.isConnected) return;
  area.style.height = 'auto';
  area.style.height = `${area.scrollHeight + 2}px`;
}

/** A text area that grows with what's written in it. Each draw fits every one on the page (`fit`). */
export function textArea(label: string, rows: number, className = 'field area grow'): HTMLTextAreaElement {
  const area = h('textarea', { className, rows, 'aria-label': label, placeholder: label, spellcheck: 'true' });
  area.addEventListener('input', () => fit(area));
  return area;
}

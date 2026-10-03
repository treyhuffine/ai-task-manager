/**
 * Snapshots and what an act hands back.
 *
 * A snapshot is Playwright's AI-mode aria tree for the whole document (not just
 * `<body>`, so a popover portaled onto `<html>` still shows), filtered to the
 * efficient interactive tier. Refs (`[ref=e12]`) are stable per element for the
 * life of the document: an element keeps its ref until its role or name changes,
 * and anything that appears later gets a fresh, higher one. So diffing refs
 * against the last snapshot the agent saw says exactly what is new.
 *
 * After an act the agent needs what changed, not the whole page again. A big
 * settings page is ~150k chars and ~3,000 refs, and a suggestion list that just
 * opened sits at the very end of it. So the act's page state is:
 *
 *   - after a navigation (or the first look at a page): the full snapshot,
 *     capped like a read, with the rest spilled to a file;
 *   - on a small page: the full snapshot, with what is new listed first;
 *   - on a big page: what is new, what changed, and the region around the ref
 *     acted on, with a pointer to `browser_read` for the whole page.
 */

import type { Page } from 'playwright-core';
import { ActionError } from '@/lib/orchestrator/types';
import { applyCap } from './cap';
import { redactSecrets } from './redact';

/** The last snapshot the agent saw of one tab's document. */
export interface SnapshotBaseline {
  /** Identifies the document (a reload or navigation is a new one, refs restart). */
  docId: string;
  url: string;
  /** ref → the line it rendered as (trimmed), to tell new and changed apart. */
  lines: Map<string, string>;
}

export interface PageState {
  url: string;
  title: string;
  /** Ref-bearing elements on the whole page. */
  refCount: number;
  /** `full`: the whole page (maybe capped). `changes`: what changed, see the header lines. */
  scope: 'full' | 'changes';
  snapshot: string;
  /** Elements that appeared since the agent's last look at this page. */
  newCount?: number;
  truncated?: boolean;
  spillPath?: string;
}

/** Pages up to this size come back whole after an act. */
export const SMALL_PAGE_CHARS = 8_000;
/** The full view after a navigation is capped like a read. */
export const FULL_VIEW_MAX_CHARS = 40_000;
/** The changes view stays small enough to iterate on cheaply. */
export const CHANGES_VIEW_MAX_CHARS = 12_000;
const FULL_VIEW_HINT = 'browser_read with a selector, or a larger max_chars, shows more.';
/** When more than this share of the page is new, it is effectively a new page. */
const NEW_PAGE_RATIO = 0.6;

const REF_RE = /\[ref=([a-z0-9]+)\]/;

/**
 * Efficient tier: keep interactive and named-content lines (everything the
 * agent can act on or navigate by), drop long non-interactive prose. Lines
 * carrying a `[ref=` are the actionable set in ai mode, headings give
 * structure, and the popup roles are kept by name so a suggestion list shows
 * even when its rows carry no ref of their own.
 */
export function toEfficient(snapshot: string): string {
  const keep =
    /\[ref=|^\s*-\s*(heading|link|button|textbox|combobox|listbox|checkbox|radio|tab|menu|menuitem|menuitemcheckbox|menuitemradio|searchbox|switch|slider|option|dialog|alertdialog|tooltip)\b/;
  return snapshot
    .split('\n')
    .filter((line) => keep.test(line))
    .join('\n');
}

/**
 * The whole document's AI snapshot, rooted at `<html>`. Playwright's page-level
 * snapshot roots at `<body>`, which misses a popover mounted on `<html>`.
 */
async function rawSnapshot(page: Page): Promise<string> {
  try {
    return await page.locator('html').ariaSnapshot({ mode: 'ai' });
  } catch {
    return page.ariaSnapshot({ mode: 'ai' });
  }
}

/**
 * The document identity. `performance.timeOrigin` is fixed for a document's
 * life and differs for every new one, including a reload of the same URL, and
 * reading it leaves nothing on the page.
 */
async function documentId(page: Page): Promise<string> {
  try {
    return String(await page.evaluate(() => performance.timeOrigin));
  } catch {
    return `unknown-${Date.now()}`;
  }
}

export interface CapturedSnapshot {
  text: string;
  refCount: number;
  docId: string;
}

export interface CaptureOptions {
  /** Keep only the interactive tier (default true). */
  efficient?: boolean;
  /** Snapshot just the first element matching this CSS selector. */
  selector?: string;
}

/**
 * Capture a snapshot, redacted at the boundary.
 *
 * Playwright resolves an `aria-ref=` locator against the most recent snapshot
 * only. So a selector-scoped capture is followed by a silent page-wide one,
 * which keeps every ref the agent already holds resolving (an element keeps its
 * ref, so the scoped refs stay valid in the page-wide map too).
 */
export async function captureSnapshot(page: Page, opts: CaptureOptions = {}): Promise<CapturedSnapshot> {
  const efficient = opts.efficient ?? true;
  let raw: string;
  if (opts.selector) {
    try {
      raw = await page.locator(opts.selector).first().ariaSnapshot({ mode: 'ai', timeout: 5_000 });
    } catch (err) {
      const reason = err instanceof Error ? err.message.split('\n')[0] : String(err);
      throw new ActionError('invalid_params', `No snapshot for selector ${opts.selector}: ${reason}`);
    } finally {
      await rawSnapshot(page).catch(() => {});
    }
  } else {
    raw = await rawSnapshot(page);
  }
  const refCount = (raw.match(/\[ref=/g) ?? []).length;
  const text = redactSecrets(efficient ? toEfficient(raw) : raw);
  return { text, refCount, docId: await documentId(page) };
}

/** Index a snapshot's ref lines, to diff the next one against. */
export function baselineOf(snap: CapturedSnapshot, url: string): SnapshotBaseline {
  const lines = new Map<string, string>();
  for (const line of snap.text.split('\n')) {
    const m = REF_RE.exec(line);
    if (m) lines.set(m[1], line.trim());
  }
  return { docId: snap.docId, url, lines };
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Re-indent a block so its shallowest line sits at column zero. */
function dedent(lines: string[]): string[] {
  const min = Math.min(...lines.map(indentOf));
  return lines.map((l) => l.slice(min));
}

export interface SnapshotDiff {
  /** Line indexes of elements that appeared (with their subtrees), in document order. */
  added: number[];
  /** Line indexes of elements whose line changed (state, value, name kept). */
  changed: number[];
  /** Refs in the baseline that are gone. */
  removed: number;
  newCount: number;
}

/** Compare a snapshot with the baseline by ref. */
export function diffSnapshot(lines: string[], baseline: SnapshotBaseline): SnapshotDiff {
  const added: number[] = [];
  const changed: number[] = [];
  const seen = new Set<string>();
  let newCount = 0;
  // While inside an added subtree, its children ride along as context.
  let addedIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = indentOf(line);
    if (addedIndent >= 0 && indent > addedIndent) {
      added.push(i);
      const inner = REF_RE.exec(line);
      if (inner) {
        seen.add(inner[1]);
        if (!baseline.lines.has(inner[1])) newCount++;
      }
      continue;
    }
    addedIndent = -1;
    const m = REF_RE.exec(line);
    if (!m) continue;
    const ref = m[1];
    seen.add(ref);
    const before = baseline.lines.get(ref);
    if (before === undefined) {
      added.push(i);
      newCount++;
      addedIndent = indent;
    } else if (before !== line.trim()) {
      changed.push(i);
    }
  }
  let removed = 0;
  for (const ref of baseline.lines.keys()) if (!seen.has(ref)) removed++;
  return { added, changed, removed, newCount };
}

/**
 * The region around one ref: its ancestors (for where it sits) and a window of
 * nearby lines (its siblings and what follows, often the thing it controls).
 */
export function regionAround(lines: string[], ref: string, before = 8, after = 25): string[] | null {
  const idx = lines.findIndex((l) => l.includes(`[ref=${ref}]`));
  if (idx < 0) return null;
  const start = Math.max(0, idx - before);
  const end = Math.min(lines.length, idx + after + 1);
  const ancestors: string[] = [];
  let indent = indentOf(lines[start]);
  for (let i = start - 1; i >= 0 && ancestors.length < 6; i--) {
    const ind = indentOf(lines[i]);
    if (ind < indent) {
      ancestors.unshift(lines[i]);
      indent = ind;
    }
  }
  return dedent([...ancestors, ...lines.slice(start, end)]);
}

/** Group index runs into blocks so a subtree prints together. */
function blocks(lines: string[], idxs: number[]): string[] {
  const out: string[] = [];
  let run: string[] = [];
  let last = -2;
  for (const i of idxs) {
    if (i !== last + 1 && run.length) {
      out.push(...dedent(run));
      run = [];
    }
    run.push(lines[i]);
    last = i;
  }
  if (run.length) out.push(...dedent(run));
  return out;
}

export interface ViewInput {
  snap: CapturedSnapshot;
  url: string;
  title: string;
  /** The last snapshot the agent saw of this tab, if any. */
  baseline: SnapshotBaseline | undefined;
  /** The ref the act targeted, for the region view. */
  ref?: string;
  /** Names spill files. */
  session: string;
}

/** Decide what the agent sees after an act. Pure apart from the spill file. */
export function buildPageView(input: ViewInput): PageState {
  const { snap, url, title, baseline, ref, session } = input;
  const base = { url, title, refCount: snap.refCount };
  const lines = snap.text ? snap.text.split('\n') : [];
  const sameDocument = !!baseline && baseline.docId === snap.docId && baseline.url === url;

  if (!sameDocument) {
    const capped = applyCap(snap.text, FULL_VIEW_MAX_CHARS, session, 'snapshot', FULL_VIEW_HINT);
    return { ...base, scope: 'full', snapshot: capped.content, ...flags(capped) };
  }

  const diff = diffSnapshot(lines, baseline);
  const refLines = lines.filter((l) => REF_RE.test(l)).length;
  if (refLines > 20 && diff.newCount / refLines > NEW_PAGE_RATIO) {
    // The page was replaced in place (an SPA route change): treat it as new.
    const capped = applyCap(snap.text, FULL_VIEW_MAX_CHARS, session, 'snapshot', FULL_VIEW_HINT);
    return { ...base, scope: 'full', snapshot: capped.content, ...flags(capped) };
  }

  const newSection = diff.added.length
    ? [`# New since your last action (${diff.newCount})`, ...blocks(lines, diff.added), '']
    : [];

  if (snap.text.length <= SMALL_PAGE_CHARS) {
    const snapshot = newSection.length ? [...newSection, '# Page', snap.text].join('\n') : snap.text;
    return { ...base, scope: 'full', snapshot, ...(diff.newCount ? { newCount: diff.newCount } : {}) };
  }

  const sections: string[] = [...newSection];
  if (diff.changed.length) {
    sections.push(`# Changed (${diff.changed.length})`, ...diff.changed.map((i) => lines[i].trim()), '');
  }
  const region = ref ? regionAround(lines, ref) : null;
  if (region) sections.push(`# Around ${ref}`, ...region, '');
  if (!diff.added.length && !diff.changed.length) sections.push('# No elements appeared or changed', '');
  sections.push(
    `[Changes only. The page has ${snap.refCount} refs (${snap.text.length} chars)` +
      (diff.removed ? `, ${diff.removed} gone since your last look` : '') +
      '. Refs you already have still work. browser_read returns the whole page.]',
  );
  const capped = applyCap(
    sections.join('\n'),
    CHANGES_VIEW_MAX_CHARS,
    session,
    'changes',
    'browser_read with a selector narrows the page.',
  );
  return {
    ...base,
    scope: 'changes',
    snapshot: capped.content,
    ...(diff.newCount ? { newCount: diff.newCount } : {}),
    ...flags(capped),
  };
}

function flags(capped: { truncated?: boolean; spillPath?: string }) {
  return capped.truncated ? { truncated: true, spillPath: capped.spillPath } : {};
}

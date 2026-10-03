import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_ROOT_ENV } from '@/lib/config/paths';
import {
  baselineOf,
  buildPageView,
  diffSnapshot,
  regionAround,
  toEfficient,
  SMALL_PAGE_CHARS,
  type CapturedSnapshot,
} from './snapshot';

let root: string;
let prevRoot: string | undefined;

beforeAll(() => {
  prevRoot = process.env[APP_ROOT_ENV];
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-snapshot-'));
  process.env[APP_ROOT_ENV] = root;
});

afterAll(() => {
  if (prevRoot === undefined) delete process.env[APP_ROOT_ENV];
  else process.env[APP_ROOT_ENV] = prevRoot;
  fs.rmSync(root, { recursive: true, force: true });
});

const SETTINGS = [
  '- generic [ref=e1]:',
  '  - heading "Writers" [level=2] [ref=e2]',
  '  - textbox "Add a writer…" [ref=e3]',
  '  - button "Save" [ref=e4] [cursor=pointer]',
].join('\n');

function snap(text: string, docId = 'doc-1'): CapturedSnapshot {
  return { text, refCount: (text.match(/\[ref=/g) ?? []).length, docId };
}

describe('toEfficient', () => {
  it('keeps ref lines and popup roles, drops prose', () => {
    const raw = ['- paragraph: long prose here', '- listbox "Suggestions":', '  - option "Ada"', '- button "Go" [ref=e9]'].join(
      '\n',
    );
    expect(toEfficient(raw).split('\n')).toEqual(['- listbox "Suggestions":', '  - option "Ada"', '- button "Go" [ref=e9]']);
  });

  it('keeps menus, dialogs and tooltips', () => {
    const raw = ['- menu:', '  - menuitem "Copy"', '- dialog "Confirm":', '- tooltip "Saved"', '- text: hi'].join('\n');
    expect(toEfficient(raw)).not.toContain('text: hi');
    expect(toEfficient(raw).split('\n')).toHaveLength(4);
  });
});

describe('diffSnapshot', () => {
  it('finds elements that appeared, with their subtree, and ones that changed', () => {
    const base = baselineOf(snap(SETTINGS), 'https://medium.com/gitconnected/settings');
    const after = [
      '- generic [ref=e1]:',
      '  - heading "Writers" [level=2] [ref=e2]',
      '  - textbox "Add a writer…" [active] [ref=e3]: ada',
      '  - button "Save" [ref=e4] [cursor=pointer]',
      '- generic [ref=e40]:',
      '  - generic "Ada Lovelace" [ref=e41] [cursor=pointer]',
      '  - generic "Ada Byron" [ref=e42] [cursor=pointer]',
    ];
    const diff = diffSnapshot(after, base);
    expect(diff.added.map((i) => after[i])).toEqual(after.slice(4));
    expect(diff.newCount).toBe(3);
    expect(diff.changed.map((i) => after[i])).toEqual([after[2]]);
    expect(diff.removed).toBe(0);
  });

  it('counts refs that are gone', () => {
    const base = baselineOf(snap(SETTINGS), 'u');
    const diff = diffSnapshot(['- generic [ref=e1]:', '  - heading "Writers" [level=2] [ref=e2]'], base);
    expect(diff.removed).toBe(2);
    expect(diff.added).toEqual([]);
  });

  it('does not count an existing element re-parented under a new container as new', () => {
    const base = baselineOf(snap(SETTINGS), 'u');
    const after = ['- dialog "Pick" [ref=e50]:', '  - button "Save" [ref=e4] [cursor=pointer]'];
    const diff = diffSnapshot(after, base);
    expect(diff.newCount).toBe(1);
    expect(diff.added).toEqual([0, 1]);
  });
});

describe('regionAround', () => {
  it('returns the ref with its ancestors and nearby lines, dedented', () => {
    const lines = [
      '- main [ref=e1]:',
      '  - region "Settings" [ref=e2]:',
      ...Array.from({ length: 30 }, (_, i) => `    - button "B${i}" [ref=e${10 + i}]`),
    ];
    const region = regionAround(lines, 'e35', 2, 2)!;
    expect(region[0]).toBe('- main [ref=e1]:');
    expect(region[1]).toBe('  - region "Settings" [ref=e2]:');
    expect(region).toContain('    - button "B25" [ref=e35]');
    expect(region).toHaveLength(2 + 5);
  });

  it('returns null for a ref that is not on the page', () => {
    expect(regionAround(['- button [ref=e1]'], 'e99')).toBeNull();
  });
});

describe('buildPageView', () => {
  const url = 'https://medium.com/gitconnected/settings';

  it('returns the whole page on a first look', () => {
    const view = buildPageView({ snap: snap(SETTINGS), url, title: 'Settings', baseline: undefined, session: 't' });
    expect(view.scope).toBe('full');
    expect(view.snapshot).toBe(SETTINGS);
    expect(view.newCount).toBeUndefined();
  });

  it('on a small page, lists what is new first, then the page', () => {
    const base = baselineOf(snap(SETTINGS), url);
    const after = `${SETTINGS}\n- listbox [ref=e9]:\n  - option "Ada Lovelace" [ref=e10]`;
    const view = buildPageView({ snap: snap(after), url, title: 'Settings', baseline: base, ref: 'e3', session: 't' });
    expect(view.scope).toBe('full');
    expect(view.newCount).toBe(2);
    expect(view.snapshot.startsWith('# New since your last action (2)\n- listbox [ref=e9]:\n  - option "Ada Lovelace" [ref=e10]')).toBe(
      true,
    );
    expect(view.snapshot).toContain('# Page');
  });

  it('on a big page, returns only the changes and the region around the ref', () => {
    const rows = Array.from({ length: 600 }, (_, i) => `  - link "Story ${i} with a long enough title" [ref=e${100 + i}]`);
    const big = ['- main [ref=e1]:', '  - textbox "Add a writer…" [ref=e3]', ...rows].join('\n');
    expect(big.length).toBeGreaterThan(SMALL_PAGE_CHARS);
    const base = baselineOf(snap(big), url);
    const after = `${big.replace('[ref=e3]', '[active] [ref=e3]: ada')}\n- generic [ref=e900]:\n  - generic "Ada Lovelace" [ref=e901] [cursor=pointer]`;
    const view = buildPageView({ snap: snap(after), url, title: 'Settings', baseline: base, ref: 'e3', session: 't' });
    expect(view.scope).toBe('changes');
    expect(view.newCount).toBe(2);
    expect(view.snapshot.length).toBeLessThan(5_000);
    const sections = view.snapshot.split('\n').filter((l) => l.startsWith('#'));
    expect(sections).toEqual(['# New since your last action (2)', '# Changed (1)', '# Around e3']);
    expect(view.snapshot).toContain('- generic "Ada Lovelace" [ref=e901] [cursor=pointer]');
    expect(view.snapshot).toContain('browser_read returns the whole page');
  });

  it('says so when nothing changed on a big page', () => {
    const rows = Array.from({ length: 600 }, (_, i) => `- link "Story ${i} with a long enough title" [ref=e${100 + i}]`);
    const big = rows.join('\n');
    const view = buildPageView({
      snap: snap(big),
      url,
      title: '',
      baseline: baselineOf(snap(big), url),
      ref: 'e100',
      session: 't',
    });
    expect(view.scope).toBe('changes');
    expect(view.snapshot).toContain('# No elements appeared or changed');
  });

  it('treats a new document (reload or navigation) as a first look', () => {
    const base = baselineOf(snap(SETTINGS, 'doc-1'), url);
    const view = buildPageView({ snap: snap(SETTINGS, 'doc-2'), url, title: '', baseline: base, session: 't' });
    expect(view.scope).toBe('full');
    expect(view.snapshot).toBe(SETTINGS);
  });

  it('treats a page replaced in place (an SPA route change) as new', () => {
    const before = Array.from({ length: 30 }, (_, i) => `- link "Old ${i}" [ref=e${i + 1}]`).join('\n');
    const after = Array.from({ length: 30 }, (_, i) => `- link "New ${i}" [ref=e${i + 100}]`).join('\n');
    const view = buildPageView({ snap: snap(after), url, title: '', baseline: baselineOf(snap(before), url), session: 't' });
    expect(view.scope).toBe('full');
    expect(view.newCount).toBeUndefined();
  });

  it('caps the full view after a navigation and spills the rest', () => {
    const huge = Array.from({ length: 2_000 }, (_, i) => `- link "Story ${i} with a long enough title" [ref=e${i}]`).join('\n');
    const view = buildPageView({ snap: snap(huge), url, title: '', baseline: undefined, session: 't' });
    expect(view.truncated).toBe(true);
    expect(view.spillPath && fs.readFileSync(view.spillPath, 'utf8')).toBe(huge);
  });
});

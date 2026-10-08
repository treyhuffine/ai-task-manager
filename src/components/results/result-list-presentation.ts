import type { WorkResultRecord } from '@/db/types';

export function resultListTitle(result: Pick<WorkResultRecord, 'title' | 'body'>): string {
  if (result.title?.trim()) return result.title;
  const heading = result.body.split('\n').find((line) => /^\s*#{1,6}\s+\S/.test(line));
  const plain = (heading ?? result.body).replace(/^\s*#{1,6}\s+/gm, '').replace(/\[\[file:[^\]]+\]\]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
  return plain.slice(0, 140) || 'Untitled handoff';
}

/** Offset pages can overlap when another result arrives between reads. */
export function uniqueResultPages(pages: readonly (readonly WorkResultRecord[])[]): WorkResultRecord[] {
  const found = new Set<string>();
  return pages.flatMap((page) => page.filter((result) => {
    if (found.has(result.id)) return false;
    found.add(result.id);
    return true;
  }));
}

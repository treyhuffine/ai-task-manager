/**
 * Items in the `@`-mention picker. One picker covers six kinds, with a
 * discriminator so the popup can section-render and the extension can
 * dispatch to the right chip on select.
 *
 *   - file / dir — worktree paths. Insertion → MentionChipNode (`@<path>`).
 *   - task / note — entity references. Insertion → EntityChipNode
 *     (`[[task:id]]` / `[[note:id]]`).
 *   - scratchpad — the session's own scratchpad. Always one option,
 *     surfaced near the top so the user doesn't have to search for it.
 *     Insertion → EntityChipNode (`[[scratchpad]]`).
 *   - reference — a reference folder (docs/reference-folders-spec.md).
 *     Selecting one does NOT insert a chip: it rewrites the query to
 *     `@<alias>/` so the picker retargets into that folder.
 *   - pr — a GitHub pull request, reached by typing `@#` (see
 *     `pr-trigger.ts`). Insertion → PrChipNode, which serializes to a
 *     full context line via `formatPrRef`.
 */

import type { PrMentionItem } from '../pr-menu/types';

export interface FileMentionItem {
  kind: 'file' | 'dir';
  path: string;
  name: string;
  /**
   * Display label, used when the bare basename would lose useful context.
   * Set for files that came from a reference folder, where it reads
   * `alias/relative/path` so the chip says which folder the file is from.
   */
  label?: string;
  /**
   * Alias of the reference folder this path came from, when it came from one.
   * Also the signal that `path` is absolute rather than worktree-relative,
   * which is why these chips don't offer click-to-open — the file viewer only
   * resolves paths inside the worktree.
   */
  referenceAlias?: string;
}

export interface TaskMentionItem {
  kind: 'task';
  id: string;
  title: string;
  /** active | done | archived — drives chip icon and ranking. */
  status: string;
}

export interface NoteMentionItem {
  kind: 'note';
  id: string;
  title: string;
}

export interface ScratchpadMentionItem {
  kind: 'scratchpad';
}

export interface ReferenceFolderMentionItem {
  kind: 'reference';
  id: string;
  alias: string;
  absolutePath: string;
  /** False when the folder is missing on disk: listed, but not browsable. */
  exists: boolean;
}

/**
 * A pull request surfaced under `@#`. Extends the wire shape the PR chip
 * consumes (`PrMentionItem`) with the picker discriminator, so selecting
 * one can drop the `kind` and hand the rest straight to `insertPrChip`.
 */
export interface PrMentionMenuItem extends PrMentionItem {
  kind: 'pr';
}

export type MentionItem =
  | FileMentionItem
  | TaskMentionItem
  | NoteMentionItem
  | ScratchpadMentionItem
  | ReferenceFolderMentionItem
  | PrMentionMenuItem;

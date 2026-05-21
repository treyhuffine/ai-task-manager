/**
 * Items in the `@`-mention picker. One picker covers four kinds, with a
 * discriminator so the popup can section-render and the extension can
 * dispatch to the right chip on select.
 *
 *   - file / dir — worktree paths. Insertion → MentionChipNode (`@<path>`).
 *   - task / note — entity references. Insertion → EntityChipNode
 *     (`[[task:id]]` / `[[note:id]]`).
 *   - scratchpad — the session's own scratchpad. Always one option,
 *     surfaced near the top so the user doesn't have to search for it.
 *     Insertion → EntityChipNode (`[[scratchpad]]`).
 */

export interface FileMentionItem {
  kind: 'file' | 'dir';
  path: string;
  name: string;
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

export type MentionItem =
  | FileMentionItem
  | TaskMentionItem
  | NoteMentionItem
  | ScratchpadMentionItem;

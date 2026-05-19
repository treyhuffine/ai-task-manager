/**
 * Wire shape for an item in the @-mention popup. Lighter than
 * `TreeEntry` — only what the menu needs to render and what the
 * editor needs to insert. Wrapping the entry keeps the suggestion
 * extension decoupled from the executor's API types.
 */
export interface MentionItem {
  /** Worktree-relative POSIX path — what gets inserted as `@<path> `. */
  path: string
  /** Display name (basename). */
  name: string
  kind: 'file' | 'dir'
}

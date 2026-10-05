import TaskItemBase from '@tiptap/extension-task-item'
import type { Command } from '@tiptap/pm/state'

/**
 * Enter at the very start of a task item that has text: a new empty item opens
 * above it, and the item itself (its text, its check, anything nested under it)
 * moves down unchanged. That's what Notion, Google Docs and Apple Notes do.
 *
 * Tiptap's own Enter splits the item instead. At the start, the split leaves
 * the original node on top, empty but still checked, and moves the text into a
 * new node below, unchecked (`checked` doesn't carry over on a split). So a
 * done item looked undone and an empty line looked done. Anywhere else in the
 * item the split is right, and still runs.
 */
export function openTaskItemAbove(itemTypeName: string): Command {
  return (state, dispatch) => {
    const { selection } = state
    if (!selection.empty) return false
    const { $from } = selection
    // At the start of the item's first block, with text in it. An empty item
    // keeps its own behavior (Enter there leaves the list).
    if ($from.depth < 2 || $from.parentOffset !== 0 || $from.parent.content.size === 0) return false
    const item = $from.node(-1)
    if (item.type.name !== itemTypeName || $from.index(-1) !== 0) return false
    const empty = item.type.createAndFill({ ...item.attrs, checked: false })
    if (!empty) return false
    if (dispatch) {
      // Inserting before the item maps the caret forward, so it stays at the
      // start of the item's text, now one row down.
      dispatch(state.tr.insert($from.before(-1), empty).scrollIntoView())
    }
    return true
  }
}

export const TaskItem = TaskItemBase.extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Enter: () =>
        openTaskItemAbove(this.name)(this.editor.state, this.editor.view.dispatch) ||
        this.editor.commands.splitListItem(this.name),
    }
  },
})

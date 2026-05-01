import { Extension } from '@tiptap/core'

const LIST_NODE_NAMES = new Set(['bulletList', 'orderedList', 'taskList'])

/**
 * Two small overrides on top of StarterKit's defaults:
 *
 * - Backspace on an EMPTY list item exits the list to a paragraph in one
 *   press. The default lifts only one nesting level. Non-empty items fall
 *   through so you still get standard "merge with previous."
 * - Tab / Shift-Tab try sink/lift for both bullet and task items, then
 *   always consume the keystroke so focus can't escape the editor when no
 *   list operation applies (e.g., cursor in a paragraph, or first item of
 *   a list which can't be sunk).
 */
export const ListKeymap = Extension.create({
  name: 'listKeymap',
  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { editor } = this
        const { $from, empty } = editor.state.selection
        if (!empty || $from.parentOffset !== 0) return false
        if ($from.parent.content.size > 0) return false

        for (let depth = $from.depth; depth > 0; depth--) {
          if (LIST_NODE_NAMES.has($from.node(depth).type.name)) {
            return editor.commands.clearNodes()
          }
        }
        return false
      },
      Tab: () => {
        const { editor } = this
        editor.commands.sinkListItem('listItem') ||
          editor.commands.sinkListItem('taskItem')
        return true
      },
      'Shift-Tab': () => {
        const { editor } = this
        editor.commands.liftListItem('listItem') ||
          editor.commands.liftListItem('taskItem')
        return true
      },
    }
  },
})

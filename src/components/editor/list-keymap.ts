import { Extension } from '@tiptap/core'

const LIST_NODE_NAMES = new Set(['bulletList', 'orderedList', 'taskList'])
const ITEM_TYPES = ['listItem', 'taskItem'] as const

/**
 * Notion/Medium-style list keymap.
 *
 * - Backspace at the start of a list item exits the list to a paragraph.
 *   StarterKit's default only outdents one level, so a deeply nested item
 *   takes several presses to escape.
 * - Tab / Shift-Tab nest and outdent across both bullet/ordered lists and
 *   task lists. StarterKit's ListItem only binds Tab to `listItem`, so tasks
 *   were missing it.
 */
export const ListKeymap = Extension.create({
  name: 'listKeymap',
  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { editor } = this
        const { selection } = editor.state
        const { $from, empty } = selection
        if (!empty || $from.parentOffset !== 0) return false

        for (let depth = $from.depth; depth > 0; depth--) {
          if (LIST_NODE_NAMES.has($from.node(depth).type.name)) {
            return editor.commands.clearNodes()
          }
        }
        return false
      },
      Tab: () => {
        const { editor } = this
        for (const type of ITEM_TYPES) {
          if (editor.can().sinkListItem(type) && editor.commands.sinkListItem(type)) {
            return true
          }
        }
        return false
      },
      'Shift-Tab': () => {
        const { editor } = this
        for (const type of ITEM_TYPES) {
          if (editor.can().liftListItem(type) && editor.commands.liftListItem(type)) {
            return true
          }
        }
        return false
      },
    }
  },
})

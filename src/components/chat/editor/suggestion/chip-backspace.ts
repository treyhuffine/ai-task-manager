import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'

/**
 * Shared Backspace behavior for suggestion-driven chip atoms.
 *
 * When the user hits Backspace adjacent to (or on) a chip of the
 * given kind, delete the chip and leave the trigger character (`@`,
 * `#`, etc.) in its place. The Suggestion plugin watching that
 * character then re-opens its popup automatically, so the user can
 * pick a different item without re-typing the trigger.
 *
 * Returns `true` when the chip-restore path fires (Tiptap treats that
 * as "handled" and skips its default Backspace behavior), `false`
 * otherwise so normal text editing isn't disturbed.
 *
 * Handles two selection shapes:
 *   - NodeSelection on the chip itself (the typical "second-Backspace"
 *     state for inline atoms — first selects, second deletes).
 *   - Empty caret selection immediately after the chip (one-shot
 *     Backspace from the right side, before ProseMirror has had a
 *     chance to convert the caret into a NodeSelection).
 */
export function handleChipBackspace(
  editor: Editor,
  chipName: string,
  triggerChar: string,
): boolean {
  const { selection } = editor.state

  if (selection instanceof NodeSelection && selection.node.type.name === chipName) {
    const pos = selection.from
    editor
      .chain()
      .focus()
      .deleteSelection()
      .insertContentAt(pos, triggerChar)
      .run()
    return true
  }

  if (selection.empty) {
    const $from = selection.$from
    const before = $from.nodeBefore
    if (before?.type.name === chipName) {
      const chipPos = $from.pos - before.nodeSize
      editor
        .chain()
        .focus()
        .deleteRange({ from: chipPos, to: $from.pos })
        .insertContentAt(chipPos, triggerChar)
        .run()
      return true
    }
  }

  return false
}

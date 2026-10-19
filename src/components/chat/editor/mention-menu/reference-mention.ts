import { isHistoryTransaction } from '@tiptap/pm/history'
import type { Node } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { canBrowseReference } from './ranking'
import type { ReferenceFolderMentionItem } from './types'

const referenceMentionKey = new PluginKey('referenceMention')

function referenceForNode(node: Node | null, references: ReferenceFolderMentionItem[]) {
  if (node?.type.name !== 'mentionChip' || node.attrs.kind !== 'dir') return undefined
  return references.find(reference => reference.exists
    && reference.alias === node.attrs.referenceAlias
    && reference.alias === node.attrs.label
    && reference.absolutePath === node.attrs.path)
}

function referenceBeforeCursor(state: EditorState, references: ReferenceFolderMentionItem[]) {
  if (!state.selection.empty) return undefined
  return referenceForNode(state.selection.$from.nodeBefore, references)
}

/** A selected linked folder is already a usable mention. Only an explicit
 * slash opens the file picker, and the hint
 * is a decoration so it never enters drafts, copied text or sent messages.
 */
export function createReferenceMentionPlugin(
  getReferences: () => ReferenceFolderMentionItem[],
  isComposing: () => boolean = () => false,
) {
  let editorView: EditorView | null = null

  return new Plugin({
    key: referenceMentionKey,
    view(view) {
      editorView = view
      return { destroy() { editorView = null } }
    },
    appendTransaction(transactions, _oldState, state) {
      if (isComposing() || !state.selection.empty
        || !transactions.some(transaction => transaction.docChanged)
        || transactions.some(transaction => transaction.getMeta(referenceMentionKey) || isHistoryTransaction(transaction))) return null

      const { $from } = state.selection
      const before = $from.nodeBefore
      if (!before?.isText || !before.text?.startsWith('/')) return null
      const chipEnd = $from.pos - before.nodeSize
      const reference = referenceForNode(state.doc.resolve(chipEnd).nodeBefore, getReferences())
      if (!reference || !canBrowseReference(reference)) return null

      return state.tr.insertText(`@${reference.alias}`, chipEnd - 1, chipEnd).setMeta(referenceMentionKey, 'browse')
    },
    props: {
      handleKeyDown(view, event) {
        if (event.key !== 'Backspace' || event.isComposing || view.composing
          || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false
        const { selection } = view.state
        const node = selection instanceof NodeSelection ? selection.node : selection.empty ? selection.$from.nodeBefore : null
        const reference = referenceForNode(node, getReferences())
        if (!reference) return false
        const from = selection instanceof NodeSelection ? selection.from : selection.from - 1
        // Restore the name so the user can edit it and select another result.
        view.dispatch(view.state.tr.insertText(`@${reference.alias}`, from, from + 1).setMeta(referenceMentionKey, 'edit'))
        return true
      },
      decorations(state) {
        if (!editorView?.hasFocus()) return null
        const reference = referenceBeforeCursor(state, getReferences())
        if (!reference || !canBrowseReference(reference)) return null
        return DecorationSet.create(state.doc, [Decoration.widget(state.selection.from, view => {
          const hint = view.dom.ownerDocument.createElement('span')
          hint.dataset.referenceMentionHint = ''
          hint.contentEditable = 'false'
          hint.setAttribute('aria-hidden', 'true')
          hint.className = 'pointer-events-none select-none pl-2 text-[12px] font-normal text-muted-foreground/50'
          hint.textContent = 'Or type / for a specific file'
          return hint
        }, { side: 1, key: `reference-hint:${reference.id}`, ignoreSelection: true })])
      },
    },
  })
}

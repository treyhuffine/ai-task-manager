import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TaskItem, openTaskItemAbove } from './task-item'

const extensions = [StarterKit, TaskList, TaskItem.configure({ nested: true })]
const schema = getSchema(extensions)
const markdown = new MarkdownManager({ extensions })

function stateFrom(md: string, caret: (doc: PMNode) => number): EditorState {
  const doc = schema.nodeFromJSON(markdown.parse(md))
  return EditorState.create({ doc, selection: TextSelection.create(doc, caret(doc)) })
}

/** Position of the first character of the text `needle`. */
function startOf(needle: string) {
  return (doc: PMNode) => {
    let at = -1
    doc.descendants((node, pos) => {
      if (at === -1 && node.isText && node.text?.includes(needle)) at = pos + node.text.indexOf(needle)
    })
    if (at === -1) throw new Error(`no ${needle}`)
    return at
  }
}

function endOf(needle: string) {
  return (doc: PMNode) => startOf(needle)(doc) + needle.length
}

function enter(state: EditorState): { handled: boolean; state: EditorState } {
  let next = state
  const handled = openTaskItemAbove('taskItem')(state, (tr) => {
    next = state.apply(tr)
  })
  return { handled, state: next }
}

const md = (state: EditorState) => markdown.serialize(state.doc.toJSON()).trim()

describe('Enter in a task item', () => {
  it('at the start of a checked item opens an empty item above, and the checked item moves down intact', () => {
    const { handled, state } = enter(stateFrom('- [x] ship it\n- [ ] next', startOf('ship it')))
    expect(handled).toBe(true)
    // Saved as markdown, the check stays on its own text.
    expect(md(state)).toMatch(/^- \[ \] ?\n- \[x\] ship it\n- \[ \] next$/)
    const items: Array<{ checked: boolean; text: string }> = []
    state.doc.descendants((node) => {
      if (node.type.name === 'taskItem') items.push({ checked: node.attrs.checked, text: node.textContent })
    })
    expect(items).toEqual([
      { checked: false, text: '' },
      { checked: true, text: 'ship it' },
      { checked: false, text: 'next' },
    ])
    // The caret stays with the text it was in front of.
    expect(state.selection.$from.parent.textContent).toBe('ship it')
    expect(state.selection.$from.parentOffset).toBe(0)
  })

  it('at the start of an unchecked item does the same, leaving the item as it was', () => {
    const { handled, state } = enter(stateFrom('- [ ] draft', startOf('draft')))
    expect(handled).toBe(true)
    expect(md(state)).toMatch(/^- \[ \] ?\n- \[ \] draft$/)
  })

  it('keeps a nested list with the item it belongs to', () => {
    const { state } = enter(stateFrom('- [x] parent\n  - [x] child', startOf('parent')))
    const top: Array<{ checked: boolean; text: string; nested: number }> = []
    state.doc.firstChild!.forEach((item) => top.push({ checked: item.attrs.checked, text: item.firstChild!.textContent, nested: item.childCount - 1 }))
    expect(top).toEqual([
      { checked: false, text: '', nested: 0 },
      { checked: true, text: 'parent', nested: 1 },
    ])
  })

  it('leaves every other Enter to the normal split', () => {
    // At the end, and in the middle, the split is already right.
    expect(enter(stateFrom('- [x] ship it', endOf('ship it'))).handled).toBe(false)
    expect(enter(stateFrom('- [x] ship it', startOf('it'))).handled).toBe(false)
    // An empty item: Enter there leaves the list.
    const emptyItem = stateFrom('- [x] a\n- [ ] b', endOf('b'))
    const cleared = emptyItem.apply(emptyItem.tr.delete(emptyItem.selection.from - 1, emptyItem.selection.from))
    expect(enter(cleared).handled).toBe(false)
    // Not a task item at all.
    expect(enter(stateFrom('- bullet', startOf('bullet'))).handled).toBe(false)
    expect(enter(stateFrom('plain', startOf('plain'))).handled).toBe(false)
  })
})

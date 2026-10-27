import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import { CollapsibleHeading } from './collapsible-heading'
import { Paragraph } from './paragraph'
import { TaskItem } from './task-item'
import { LIST_FORMATS, balancedMenuWidth } from './editor-bubble-menu'

/**
 * The list buttons in the selection menu, run against the editor's own nodes
 * (patched paragraph, collapsible heading, our task item) and saved the way a
 * note or task body is saved: as markdown.
 */
let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

function open(md: string): Editor {
  editor = new Editor({
    element: null,
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, paragraph: false }),
      Paragraph,
      CollapsibleHeading,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown,
    ],
    content: md,
    contentType: 'markdown',
  })
  return editor
}

/** Selects from the first character of `first` to the last of `last`, the
 *  way dragging across lines does. */
function select(ed: Editor, first: string, last: string) {
  let from = -1
  let to = -1
  ed.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    if (from === -1 && node.text.includes(first)) from = pos + node.text.indexOf(first)
    if (node.text.includes(last)) to = pos + node.text.indexOf(last) + last.length
  })
  if (from === -1 || to === -1) throw new Error(`no ${first} … ${last}`)
  ed.commands.setTextSelection({ from, to })
}

function press(ed: Editor, title: (typeof LIST_FORMATS)[number]['title']) {
  const format = LIST_FORMATS.find((f) => f.title === title)!
  return format.toggle(ed.chain()).run()
}

const lit = (ed: Editor) => LIST_FORMATS.filter((f) => ed.isActive(f.node)).map((f) => f.title)

const LINES = 'List all the problems\n\nSearch other notes'

describe('list buttons on selected lines', () => {
  it('Bullet list makes one bullet per selected line', () => {
    const ed = open(LINES)
    select(ed, 'List all', 'other notes')
    expect(press(ed, 'Bullet list')).toBe(true)
    expect(ed.getMarkdown().trim()).toBe('- List all the problems\n- Search other notes')
    expect(lit(ed)).toEqual(['Bullet list'])
  })

  it('Numbered list numbers them', () => {
    const ed = open(LINES)
    select(ed, 'List all', 'other notes')
    expect(press(ed, 'Numbered list')).toBe(true)
    expect(ed.getMarkdown().trim()).toBe('1. List all the problems\n2. Search other notes')
    expect(lit(ed)).toEqual(['Numbered list'])
  })

  it('Checklist makes unchecked todos', () => {
    const ed = open(LINES)
    select(ed, 'List all', 'other notes')
    expect(press(ed, 'Checklist')).toBe(true)
    expect(ed.getMarkdown().trim()).toBe('- [ ] List all the problems\n- [ ] Search other notes')
    expect(lit(ed)).toEqual(['Checklist'])
  })

  it('pressed again, turns the list back into the lines it was', () => {
    for (const format of LIST_FORMATS) {
      const ed = open(LINES)
      select(ed, 'List all', 'other notes')
      press(ed, format.title)
      select(ed, 'List all', 'other notes')
      expect(press(ed, format.title)).toBe(true)
      expect(ed.getMarkdown().trim()).toBe(LINES)
      expect(lit(ed)).toEqual([])
      ed.destroy()
    }
  })

  it('switches one kind of list to another and keeps every item', () => {
    const ed = open('- List all the problems\n- Search other notes')
    select(ed, 'List all', 'other notes')
    expect(press(ed, 'Numbered list')).toBe(true)
    expect(ed.getMarkdown().trim()).toBe('1. List all the problems\n2. Search other notes')
    select(ed, 'List all', 'other notes')
    expect(press(ed, 'Checklist')).toBe(true)
    expect(ed.getMarkdown().trim()).toBe('- [ ] List all the problems\n- [ ] Search other notes')
  })

  it('changes only the selected lines', () => {
    const ed = open(`Intro\n\n${LINES}\n\nOutro`)
    select(ed, 'List all', 'other notes')
    press(ed, 'Bullet list')
    expect(ed.getMarkdown().trim()).toBe(
      'Intro\n\n- List all the problems\n- Search other notes\n\nOutro',
    )
  })

  it('works from part of a line, the way a sloppy drag lands', () => {
    const ed = open(LINES)
    select(ed, 'all the', 'Search')
    press(ed, 'Bullet list')
    expect(ed.getMarkdown().trim()).toBe('- List all the problems\n- Search other notes')
  })

  it('turns a heading line into a list item instead of failing', () => {
    const ed = open('## Ideas\n\nSearch other notes')
    select(ed, 'Ideas', 'other notes')
    expect(press(ed, 'Bullet list')).toBe(true)
    expect(ed.getMarkdown().trim()).toBe('- Ideas\n- Search other notes')
  })
})

describe('selection menu width', () => {
  // The menu's groups as laid out: text formatting and link, headings, lists,
  // then quote and toggle (outer widths in px).
  const GROUPS = [208, 92, 92, 63]
  const ONE_ROW = 455

  it('stays one row when there is room', () => {
    expect(balancedMenuWidth(GROUPS, 1000)).toBe(ONE_ROW)
    expect(balancedMenuWidth(GROUPS, ONE_ROW)).toBe(ONE_ROW)
  })

  it('on a phone, hugs two even rows: text formatting, then line formatting', () => {
    // 420, 375 and 320px screens, less the 8px margins and the menu's own padding
    for (const available of [398, 353, 298]) {
      // Row two (headings, lists, quote and toggle) is the longer one, and row
      // one (text formatting and link) is a button short of it.
      expect(balancedMenuWidth(GROUPS, available)).toBe(92 + 92 + 63)
    }
  })

  it('just short of one row, splits evenly instead of leaving one group alone', () => {
    // Filling left to right would put three groups on the first row and quote
    // and toggle alone on the second.
    expect(balancedMenuWidth(GROUPS, ONE_ROW - 1)).toBe(92 + 92 + 63)
  })

  it('in a very narrow panel takes as many rows as it must, still no wider than needed', () => {
    expect(balancedMenuWidth(GROUPS, 230)).toBe(208)
  })

  it('narrower than its widest group, takes that group\'s width', () => {
    expect(balancedMenuWidth(GROUPS, 150)).toBe(208)
  })
})

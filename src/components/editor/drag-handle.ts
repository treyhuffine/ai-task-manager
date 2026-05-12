import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/**
 * Notion-style block gutter for Tiptap.
 *
 * Renders two controls in the left gutter that follow the hovered block:
 *  - `+` button (leftmost): click opens the slash menu — directly on empty
 *    lines, or after inserting a new paragraph below on lines with text.
 *  - `⋮⋮` drag handle (right of plus): click also opens the slash menu; drag
 *    moves the block via PM's native drop pipeline.
 *
 * Both elements are `position: absolute` siblings of view.dom inside the
 * editor wrapper, so positioning uses the editor's local coord system and is
 * immune to transformed ancestors (Radix Dialog.Content / Tailwind v4
 * `translate-*` utilities, etc.).
 *
 * Drop zone is widened by `padding-left` + matching negative `margin-left`
 * on `.rich-editor-body` (see globals.css) so PM's dragover/drop fire when
 * the cursor is over the gutter.
 */

export interface DragHandleOptions {
  /** Pixels from the editor body's left edge to the drag handle's left edge. */
  offset: number
  /** Pixels from the editor body's left edge to the plus button's left edge. */
  plusOffset: number
  /** Class applied to the drag handle. */
  className: string
  /** Class applied to the plus button. */
  plusClassName: string
  /** Extra vertical fudge after first-line centering. */
  verticalOffset: number
  /** Block-level CSS selectors the gutter will attach to. */
  blockSelectors: string[]
}

const dragHandleKey = new PluginKey('localDragHandle')

const DEFAULT_BLOCK_SELECTORS = [
  'li',
  'blockquote',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'img',
  'hr',
  '[data-node-view-wrapper]',
]

export const DragHandle = Extension.create<DragHandleOptions>({
  name: 'localDragHandle',

  addOptions() {
    return {
      offset: 24,
      plusOffset: 40,
      className: 'drag-handle',
      plusClassName: 'gutter-plus',
      verticalOffset: 0,
      blockSelectors: DEFAULT_BLOCK_SELECTORS,
    }
  },

  addProseMirrorPlugins() {
    const opts = this.options
    return [
      new Plugin({
        key: dragHandleKey,
        view: (view) => new DragHandleView(view, opts),
      }),
    ]
  },
})

class DragHandleView {
  private handle: HTMLDivElement
  private plus: HTMLButtonElement
  private blockSelector: string
  private current: { pos: number; dom: HTMLElement } | null = null
  private boundOnMouseMove: (e: MouseEvent) => void
  private boundOnDragStart: (e: DragEvent) => void
  private boundOnDragEnd: () => void
  private boundOnGutterClick: (e: MouseEvent) => void

  constructor(private view: EditorView, private opts: DragHandleOptions) {
    this.blockSelector = opts.blockSelectors.join(', ')

    this.handle = document.createElement('div')
    this.handle.className = opts.className
    this.handle.draggable = true
    this.handle.setAttribute('aria-label', 'Drag block')
    this.handle.style.opacity = '0'
    this.handle.style.pointerEvents = 'none'

    this.plus = document.createElement('button')
    this.plus.type = 'button'
    this.plus.className = opts.plusClassName
    this.plus.setAttribute('aria-label', 'Insert block')
    this.plus.style.opacity = '0'
    this.plus.style.pointerEvents = 'none'

    const wrapper = this.getWrapper()
    if (wrapper) {
      if (getComputedStyle(wrapper).position === 'static') {
        wrapper.style.position = 'relative'
      }
      wrapper.appendChild(this.plus)
      wrapper.appendChild(this.handle)
    }

    this.boundOnMouseMove = (e) => this.onMouseMove(e)
    this.boundOnDragStart = (e) => this.onDragStart(e)
    this.boundOnDragEnd = () => this.onDragEnd()
    this.boundOnGutterClick = (e) => this.onGutterClick(e)

    document.addEventListener('mousemove', this.boundOnMouseMove)
    this.handle.addEventListener('dragstart', this.boundOnDragStart)
    this.handle.addEventListener('dragend', this.boundOnDragEnd)
    this.handle.addEventListener('click', this.boundOnGutterClick)
    this.plus.addEventListener('click', this.boundOnGutterClick)
  }

  destroy() {
    document.removeEventListener('mousemove', this.boundOnMouseMove)
    this.handle.removeEventListener('dragstart', this.boundOnDragStart)
    this.handle.removeEventListener('dragend', this.boundOnDragEnd)
    this.handle.removeEventListener('click', this.boundOnGutterClick)
    this.plus.removeEventListener('click', this.boundOnGutterClick)
    this.handle.remove()
    this.plus.remove()
  }

  /** Resolve the current parent of view.dom on demand. EditorContent may
   *  reparent view.dom after we initialize, so a captured reference goes
   *  stale and would break absolute positioning math. */
  private getWrapper(): HTMLElement | null {
    return this.view.dom.parentElement
  }

  private onMouseMove(event: MouseEvent) {
    const viewRect = this.view.dom.getBoundingClientRect()
    const padLeft = parseFloat(getComputedStyle(this.view.dom).paddingLeft || '0') || 0
    const contentLeft = viewRect.left + padLeft
    // Hit zone extends past the plus button (leftmost) so the gutter stays
    // visible while the cursor travels into it.
    const inVertical = event.clientY >= viewRect.top && event.clientY <= viewRect.bottom
    const inHorizontal =
      event.clientX >= viewRect.left - this.opts.plusOffset - 24 &&
      event.clientX <= viewRect.right + 8
    if (!inVertical || !inHorizontal) {
      this.hide()
      return
    }
    const probeX = Math.max(contentLeft + 8, Math.min(event.clientX, viewRect.right - 8))
    const target = this.findBlockAtCoords(probeX, event.clientY)
    if (!target) {
      this.hide()
      return
    }
    this.current = target
    this.position(target.dom)
  }

  private hide() {
    this.handle.style.opacity = '0'
    this.handle.style.pointerEvents = 'none'
    this.plus.style.opacity = '0'
    this.plus.style.pointerEvents = 'none'
    this.current = null
  }

  private position(blockDom: HTMLElement) {
    const wrapper = this.getWrapper()
    if (!wrapper) return
    const blockRect = blockDom.getBoundingClientRect()
    const wrapperRect = wrapper.getBoundingClientRect()
    // Center the 24px controls on the block's first line of text.
    const cs = getComputedStyle(blockDom)
    const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2
    const paddingTop = parseFloat(cs.paddingTop) || 0
    const top =
      blockRect.top - wrapperRect.top + paddingTop + (lineHeight - 24) / 2 + this.opts.verticalOffset

    this.handle.style.top = `${top}px`
    this.handle.style.left = `-${this.opts.offset}px`
    this.handle.style.opacity = '1'
    this.handle.style.pointerEvents = 'auto'

    this.plus.style.top = `${top}px`
    this.plus.style.left = `-${this.opts.plusOffset}px`
    this.plus.style.opacity = '1'
    this.plus.style.pointerEvents = 'auto'
  }

  private findBlockAtCoords(x: number, y: number): { pos: number; dom: HTMLElement } | null {
    const root = this.view.dom
    for (const candidate of document.elementsFromPoint(x, y)) {
      if (!(candidate instanceof HTMLElement)) continue
      if (!root.contains(candidate) || candidate === root) continue
      const target = candidate.closest(this.blockSelector) as HTMLElement | null
      if (!target || !root.contains(target)) continue

      const probe = target.firstChild ?? target
      const pos = this.view.posAtDOM(probe, 0)
      if (pos < 0) continue
      const $pos = this.view.state.doc.resolve(pos)

      // Top-level leaf blocks (img, hr) resolve to depth 0 — there's no
      // ancestor textblock to walk up to, so target the node at `pos`
      // directly. Without this the depth loop below skips them.
      if ($pos.depth === 0 && $pos.nodeAfter) {
        const blockDom = (this.view.nodeDOM(pos) as HTMLElement | null) ?? target
        return { pos, dom: blockDom }
      }

      // Granularity: drag list items as units, otherwise the top-level block.
      let depth = 1
      for (let d = $pos.depth; d >= 1; d -= 1) {
        const name = $pos.node(d).type.name
        if (name === 'listItem' || name === 'taskItem') {
          depth = d
          break
        }
      }
      if ($pos.depth < depth) continue
      const blockPos = $pos.before(depth)
      const blockDom = (this.view.nodeDOM(blockPos) as HTMLElement | null) ?? target
      return { pos: blockPos, dom: blockDom }
    }
    return null
  }

  private onDragStart(event: DragEvent) {
    if (!event.dataTransfer || !this.current) return
    const { pos, dom } = this.current

    // Build the slice and selection *without* dispatching. The dispatch (and
    // view.focus / hide) mutates the DOM, which some browsers treat as a
    // dragstart cancellation — the drag operation aborts before any dragover
    // fires anywhere. Anything that mutates the DOM is deferred via
    // `setTimeout(0)` so it runs after the browser has finalized the drag.
    const nodeSelection = NodeSelection.create(this.view.state.doc, pos)
    const slice = nodeSelection.content()

    type SerializeFn = (slice: ReturnType<typeof nodeSelection.content>) => {
      dom: HTMLElement
      text: string
    }
    const serializeForClipboard = (this.view as unknown as { serializeForClipboard?: SerializeFn })
      .serializeForClipboard
    if (typeof serializeForClipboard === 'function') {
      const serialized = serializeForClipboard.call(this.view, slice)
      event.dataTransfer.clearData()
      event.dataTransfer.setData('text/html', serialized.dom.innerHTML)
      event.dataTransfer.setData('text/plain', serialized.text)
    }
    event.dataTransfer.effectAllowed = 'copyMove'
    const ghost = this.makeDragImage(dom)
    event.dataTransfer.setDragImage(ghost, 12, Math.min(12, dom.getBoundingClientRect().height / 2))
    setTimeout(() => ghost.remove(), 0)

    ;(this.view as unknown as { dragging: { slice: typeof slice; move: boolean; node: NodeSelection } }).dragging = {
      slice,
      move: !event.ctrlKey,
      node: nodeSelection,
    }

    setTimeout(() => {
      if (this.view.isDestroyed) return
      this.view.focus()
      this.view.dispatch(this.view.state.tr.setSelection(nodeSelection))
      this.hide()
    }, 0)
  }

  /** Build a transparent, half-opacity clone of the block to use as the
   *  drag image. The browser captures its visual state at setDragImage
   *  time and then we remove it. */
  private makeDragImage(source: HTMLElement): HTMLElement {
    const ghost = source.cloneNode(true) as HTMLElement
    ghost.classList.remove('ProseMirror-selectednode')
    const rect = source.getBoundingClientRect()
    Object.assign(ghost.style, {
      position: 'fixed',
      top: '-10000px',
      left: '-10000px',
      width: `${rect.width}px`,
      opacity: '0.5',
      backgroundColor: 'transparent',
      boxShadow: 'none',
      outline: 'none',
      margin: '0',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>)
    document.body.appendChild(ghost)
    return ghost
  }

  private onDragEnd() {
    const { state } = this.view
    if (state.selection instanceof NodeSelection) {
      const tr = state.tr.setSelection(Selection.near(state.doc.resolve(state.selection.to)))
      this.view.dispatch(tr)
    }
  }

  /**
   * Click on either gutter control: if the targeted block is empty, place
   * the cursor inside it; otherwise insert a fresh paragraph after the
   * block. Either way, insert "/" so the SlashCommands suggestion plugin
   * activates and the user gets the block-type menu without a second action.
   */
  private onGutterClick(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    if (!this.current) return
    const { pos } = this.current
    const node = this.view.state.doc.nodeAt(pos)
    if (!node) return

    const isEmpty = node.isTextblock && node.content.size === 0
    let tr = this.view.state.tr
    let cursorPos: number

    if (isEmpty) {
      cursorPos = pos + 1
      tr = tr.setSelection(TextSelection.create(tr.doc, cursorPos))
    } else {
      const endOfBlock = pos + node.nodeSize
      const paraType = this.view.state.schema.nodes.paragraph
      if (!paraType) return
      tr = tr.insert(endOfBlock, paraType.create())
      cursorPos = endOfBlock + 1
      tr = tr.setSelection(TextSelection.create(tr.doc, cursorPos))
    }

    tr = tr.insertText('/')
    this.view.dispatch(tr)
    this.view.focus()
  }
}

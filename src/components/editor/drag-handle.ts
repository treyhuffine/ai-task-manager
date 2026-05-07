import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey, Selection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/**
 * Notion-style global drag handle for Tiptap.
 *
 * Renders a six-dot grip in the editor's gutter that follows the hovered
 * block. Click+drag triggers an HTML5 drag with PM-shaped dataTransfer; the
 * actual move is handled by ProseMirror's native drop. The handle is a
 * `position: absolute` sibling inside the editor wrapper so positioning
 * uses the editor's local coord system, immune to any transformed ancestors
 * (Radix Dialog.Content / Tailwind v4 `translate-*` utilities, etc.).
 *
 * Drop zone is widened by `padding-left` + matching negative `margin-left`
 * on `.rich-editor-body` (see globals.css) so PM's dragover/drop fire when
 * the cursor is over the gutter.
 */

export interface DragHandleOptions {
  /** Pixels from the editor body's left edge to the handle's left edge. */
  offset: number
  /** Class applied to the handle element. Kept as `drag-handle` so the
   * existing CSS rule works unchanged for either implementation. */
  className: string
  /** Extra vertical fudge after first-line centering. */
  verticalOffset: number
  /** Block-level CSS selectors the handle will attach to. */
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
  '[data-node-view-wrapper]',
]

export const DragHandle = Extension.create<DragHandleOptions>({
  name: 'localDragHandle',

  addOptions() {
    return {
      offset: 24,
      className: 'drag-handle',
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
  private blockSelector: string
  private current: { pos: number; dom: HTMLElement } | null = null
  private boundOnMouseMove: (e: MouseEvent) => void
  private boundOnDragStart: (e: DragEvent) => void
  private boundOnDragEnd: () => void

  constructor(private view: EditorView, private opts: DragHandleOptions) {
    this.blockSelector = opts.blockSelectors.join(', ')

    this.handle = document.createElement('div')
    this.handle.className = opts.className
    this.handle.draggable = true
    this.handle.setAttribute('aria-label', 'Drag block')
    this.handle.style.opacity = '0'
    this.handle.style.pointerEvents = 'none'

    // Append into the current parent. Tiptap React's <EditorContent> reparents
    // view.dom into its own ref div *after* our plugin initializes; the handle
    // gets moved along since it's a sibling of view.dom under the same parent.
    const wrapper = this.getWrapper()
    if (wrapper) {
      if (getComputedStyle(wrapper).position === 'static') {
        wrapper.style.position = 'relative'
      }
      wrapper.appendChild(this.handle)
    }

    this.boundOnMouseMove = (e) => this.onMouseMove(e)
    this.boundOnDragStart = (e) => this.onDragStart(e)
    this.boundOnDragEnd = () => this.onDragEnd()

    // Document-level mousemove + explicit hit zone — see onMouseMove. A
    // wrapper-scoped listener would hide the handle the moment the cursor
    // entered the gutter en route to grabbing it.
    document.addEventListener('mousemove', this.boundOnMouseMove)
    this.handle.addEventListener('dragstart', this.boundOnDragStart)
    this.handle.addEventListener('dragend', this.boundOnDragEnd)
  }

  destroy() {
    document.removeEventListener('mousemove', this.boundOnMouseMove)
    this.handle.removeEventListener('dragstart', this.boundOnDragStart)
    this.handle.removeEventListener('dragend', this.boundOnDragEnd)
    this.handle.remove()
  }

  /** Resolve the current parent of view.dom on demand. EditorContent may
   *  reparent view.dom after we initialize, so a captured reference goes
   *  stale and would break absolute positioning math. */
  private getWrapper(): HTMLElement | null {
    return this.view.dom.parentElement
  }

  private onMouseMove(event: MouseEvent) {
    const viewRect = this.view.dom.getBoundingClientRect()
    // The editor body may have padding-left to extend its drop zone into
    // the gutter; the actual TEXT content starts at viewRect.left + that
    // padding. Probe inside the content area so block lookup works.
    const padLeft = parseFloat(getComputedStyle(this.view.dom).paddingLeft || '0') || 0
    const contentLeft = viewRect.left + padLeft
    // Hit zone: editor body's vertical range, horizontally extended to
    // cover the handle position even when no padding is configured.
    const inVertical = event.clientY >= viewRect.top && event.clientY <= viewRect.bottom
    const inHorizontal =
      event.clientX >= viewRect.left - this.opts.offset - 24 &&
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
    this.current = null
  }

  private position(blockDom: HTMLElement) {
    const wrapper = this.getWrapper()
    if (!wrapper) return
    const blockRect = blockDom.getBoundingClientRect()
    const wrapperRect = wrapper.getBoundingClientRect()
    // Center the 24px handle on the block's first line of text. Matches
    // the upstream package's vertical alignment so big headings, lists,
    // and paragraphs all line up the same.
    const cs = getComputedStyle(blockDom)
    const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2
    const paddingTop = parseFloat(cs.paddingTop) || 0
    const top = blockRect.top - wrapperRect.top + paddingTop + (lineHeight - 24) / 2 + this.opts.verticalOffset
    this.handle.style.top = `${top}px`
    this.handle.style.left = `-${this.opts.offset}px`
    this.handle.style.opacity = '1'
    this.handle.style.pointerEvents = 'auto'
  }

  private findBlockAtCoords(x: number, y: number): { pos: number; dom: HTMLElement } | null {
    const root = this.view.dom
    for (const candidate of document.elementsFromPoint(x, y)) {
      if (!(candidate instanceof HTMLElement)) continue
      if (!root.contains(candidate) || candidate === root) continue
      const target = candidate.closest(this.blockSelector) as HTMLElement | null
      if (!target || !root.contains(target)) continue
      // Skip empty paragraphs — the existing "+" gutter button already covers
      // those, and stacking both is visually noisy.
      if (target.tagName === 'P' && target.textContent === '') continue

      const probe = target.firstChild ?? target
      const pos = this.view.posAtDOM(probe, 0)
      if (pos < 0) continue
      const $pos = this.view.state.doc.resolve(pos)

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
    // Render the ghost as a translucent clone of the block instead of using
    // the source DOM directly. With a clone we control its opacity / bg so
    // the user can see drop targets THROUGH the dragged content.
    const ghost = this.makeDragImage(dom)
    event.dataTransfer.setDragImage(ghost, 12, Math.min(12, dom.getBoundingClientRect().height / 2))
    // Browser captures the image synchronously during this handler; remove
    // the clone right after so it doesn't leak in the DOM.
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
    // Clear the lingering NodeSelection (set during dragstart) so the heavy
    // selectednode outline doesn't persist after the drag. `Selection.near`
    // returns a TextSelection at the closest valid position — safer than
    // `TextSelection.create` which throws when `to` lands between top-level
    // blocks (e.g. when the dragged paragraph was the last node in the doc).
    const { state } = this.view
    if (state.selection instanceof NodeSelection) {
      const tr = state.tr.setSelection(Selection.near(state.doc.resolve(state.selection.to)))
      this.view.dispatch(tr)
    }
  }
}

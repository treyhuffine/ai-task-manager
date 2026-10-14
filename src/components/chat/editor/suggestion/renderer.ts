'use client'

import React, {
  type ForwardRefExoticComponent,
  type RefAttributes,
} from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { autoUpdate, computePosition, flip, hide, offset, shift, size } from '@floating-ui/dom'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import { registerOpenSuggestion } from './escape-guard'

/**
 * Shared imperative-handle shape for popup components. The Tiptap
 * `Suggestion` extension's render lifecycle forwards arrow-key /
 * Enter / Escape events through this hook so the React component can
 * drive its own selection state without a custom keymap.
 */
export interface SuggestionPopupRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

/**
 * Generic Tiptap Suggestion `render` factory. Mounts the supplied
 * popup component into the DOM (next to the editor or inside a Radix
 * dialog if one wraps the composer), keeps it beside the trigger, and tears
 * it down when the suggestion closes.
 *
 * Used by chat and document suggestion menus. Chat menus match the composer
 * width above the trigger. Document slash menus prefer below the trigger.
 *
 * Chat menus use the full composer width above the trigger. Floating UI resolves
 * the actual fixed containing block, including untransformed dialogs, and
 * keeps the list within the visible viewport when the keyboard is open.
 */
export type SuggestionPopupComponent<TItem> = ForwardRefExoticComponent<
  {
    items: TItem[]
    command: (item: TItem) => void
    /** The text after the trigger character that produced `items`. */
    query?: string
  } & RefAttributes<SuggestionPopupRef>
>

// What async `items` functions returned, told apart by identity from the
// `[]` Tiptap puts on a query's props before its items land.
const landed = new WeakSet<object>()

/**
 * Wrap what an async `items` returns, in an extension whose renderer sets
 * `asyncItems`. Unwrapped lists (Tiptap's stand-in) never render.
 */
export function settledItems<TItem>(items: TItem[]): TItem[] {
  landed.add(items)
  return items
}

export interface SuggestionPopupRendererOptions {
  popupClassName?: string
  placement?: 'top-start' | 'bottom-start'
  matchEditorWidth?: boolean
  gap?: number
  /**
   * The extension's `items` is async and returns through `settledItems`.
   * Tiptap hands the renderer its newest query before that query's items
   * have landed, with `[]` standing in, so without this a list that waits
   * on the server flashes empty on every keystroke. With it the last list
   * stays on screen until the new one lands.
   */
  asyncItems?: boolean
  /**
   * Called when the user explicitly dismisses the menu with Escape (as
   * opposed to the menu closing because the match broke). The `#` menu
   * uses this to remember that the user meant the number as literal
   * text, so the send path doesn't quietly re-link it.
   */
  onDismiss?: () => void
}

export function createSuggestionPopupRenderer<TItem>(
  Component: SuggestionPopupComponent<TItem>,
  options?: SuggestionPopupRendererOptions,
) {
  const popupClassName = options?.popupClassName ?? 'slash-command-popup'
  return () => {
    let popup: HTMLDivElement | null = null
    let root: Root | null = null
    let componentRef: SuggestionPopupRef | null = null
    let releaseEscape: (() => void) | null = null
    let releasePosition: (() => void) | null = null
    let updatePosition: (() => void) | null = null
    let latestProps: SuggestionProps<TItem> | null = null
    // Escape closes the menu for the rest of the current token. The
    // Tiptap plugin stays active on purpose — force-exiting it would
    // let the very next keystroke re-match `#1` → `#12` and pop the
    // menu straight back open, which is the opposite of dismissing.
    // `onExit` clears the flag once the match breaks, so the next `#`
    // opens normally.
    let dismissed = false

    return {
      onStart(props: SuggestionProps<TItem>) {
        cleanup()
        dismissed = false
        latestProps = props
        popup = document.createElement('div')
        popup.className = popupClassName
        Object.assign(popup.style, { position: 'fixed', top: '0', left: '0', visibility: 'hidden', zIndex: '999' })
        // Mount inside the nearest Radix Dialog when present — Radix sets
        // pointer-events: none on body siblings of a modal dialog, which
        // would otherwise block clicks and scrollbar drags on the menu.
        const editorDom = props.editor.view.dom as HTMLElement
        const host =
          (editorDom.closest('[role="dialog"]') as HTMLElement | null) ??
          (editorDom.closest('[data-radix-popper-content-wrapper]') as HTMLElement | null) ??
          document.body
        host.appendChild(popup)

        root = createRoot(popup)
        renderList(props)

        startPositioning(popup, editorDom)

        releaseEscape?.()
        releaseEscape = registerOpenSuggestion({
          dismiss,
          isFocused: () => props.editor.view.hasFocus(),
        })
      },

      onUpdate(props: SuggestionProps<TItem>) {
        if (dismissed) return
        latestProps = props
        renderList(props)
        updatePosition?.()
      },

      onKeyDown(props: SuggestionKeyDownProps) {
        // Normally the window-capture guard has already handled Escape
        // before ProseMirror sees it. This is the fallback for anything
        // that dispatches straight at the editor. Returning `true`
        // stops the Tiptap plugin from force-exiting the suggestion —
        // see the `dismissed` note above.
        if (props.event.key === 'Escape' || props.event.key === 'Esc') {
          dismiss()
          return true
        }
        return componentRef?.onKeyDown(props) ?? false
      },

      onExit() {
        dismissed = false
        cleanup()
      },
    }

    function renderList(props: SuggestionProps<TItem>) {
      if (options?.asyncItems && !landed.has(props.items)) return
      root?.render(
        React.createElement(Component, {
          ref: (r: SuggestionPopupRef | null) => {
            componentRef = r
          },
          items: props.items,
          command: (item: TItem) => props.command(item),
          query: props.query,
        }),
      )
    }

    function dismiss() {
      if (dismissed) return
      dismissed = true
      cleanup()
      options?.onDismiss?.()
    }

    function startPositioning(el: HTMLDivElement, editorDom: HTMLElement) {
      let live = true
      let revision = 0
      const matchEditorWidth = options?.matchEditorWidth ?? true
      const reference = {
        contextElement: editorDom,
        getBoundingClientRect() {
          const trigger = latestProps?.clientRect?.()
          if (!trigger) return new DOMRect()
          if (!matchEditorWidth) return trigger
          const editor = editorDom.getBoundingClientRect()
          return new DOMRect(editor.left, trigger.top, editor.width, trigger.height)
        },
      }
      updatePosition = () => {
        const current = ++revision
        if (!latestProps?.clientRect?.()) {
          el.style.visibility = 'hidden'
          return
        }
        void computePosition(reference, el, {
          strategy: 'fixed',
          placement: options?.placement ?? 'top-start',
          middleware: [
            offset(options?.gap ?? 6),
            flip({ padding: 8 }),
            shift({ padding: 8 }),
            size({ padding: 8, apply({ availableHeight, availableWidth, rects }) {
              if (!live || current !== revision) return
              Object.assign(el.style, {
                ...(matchEditorWidth ? { width: `${Math.min(rects.reference.width, Math.max(0, availableWidth))}px` } : {}),
                maxWidth: `${Math.max(0, availableWidth)}px`,
                maxHeight: `${Math.max(0, availableHeight)}px`,
                overflowY: 'auto',
              })
            } }),
            hide({ strategy: 'referenceHidden' }),
          ],
        }).then(({ x, y, middlewareData }) => {
          // An async position computed before a keystroke or teardown must
          // not move a newer menu or revive a dismissed one.
          if (!live || current !== revision) return
          Object.assign(el.style, {
            left: `${x}px`,
            top: `${y}px`,
            visibility: middlewareData.hide?.referenceHidden ? 'hidden' : 'visible',
          })
        })
      }
      // Scroll, resize, async result height and visualViewport changes all
      // matter. Frame tracking also follows Radix's transform animations.
      const stop = autoUpdate(reference, el, updatePosition, { animationFrame: true })
      releasePosition = () => {
        live = false
        stop()
      }
    }

    function cleanup() {
      releasePosition?.()
      releasePosition = null
      updatePosition = null
      latestProps = null
      releaseEscape?.()
      releaseEscape = null
      root?.unmount()
      root = null
      popup?.remove()
      popup = null
      componentRef = null
    }
  }
}

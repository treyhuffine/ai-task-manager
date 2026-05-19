'use client'

import React, {
  type ForwardRefExoticComponent,
  type RefAttributes,
} from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'

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
 * dialog if one wraps the composer), keeps it positioned above the
 * caret, and tears it down when the suggestion closes.
 *
 * Used by the slash, @-mention (files), and #-mention (PRs) menus —
 * all of which share the same caret-anchored, composer-width popup
 * shape but differ in what they render in the list.
 *
 * Positioning matches Conductor's behavior: full composer width
 * horizontally, anchored above the caret vertically. Handles
 * transformed ancestors (Radix Dialog / Popover) by subtracting the
 * mount host's bounding rect from the caret's viewport rect.
 */
export type SuggestionPopupComponent<TItem> = ForwardRefExoticComponent<
  {
    items: TItem[]
    command: (item: TItem) => void
  } & RefAttributes<SuggestionPopupRef>
>

export function createSuggestionPopupRenderer<TItem>(
  Component: SuggestionPopupComponent<TItem>,
  options?: { popupClassName?: string },
) {
  const popupClassName = options?.popupClassName ?? 'slash-command-popup'
  return () => {
    let popup: HTMLDivElement | null = null
    let root: Root | null = null
    let componentRef: SuggestionPopupRef | null = null
    let host: HTMLElement = document.body

    return {
      onStart(props: SuggestionProps<TItem>) {
        popup = document.createElement('div')
        popup.className = popupClassName
        // Mount inside the nearest Radix Dialog when present — Radix sets
        // pointer-events: none on body siblings of a modal dialog, which
        // would otherwise block clicks and scrollbar drags on the menu.
        const editorDom = props.editor.view.dom as HTMLElement
        host =
          (editorDom.closest('[role="dialog"]') as HTMLElement | null) ??
          (editorDom.closest('[data-radix-popper-content-wrapper]') as HTMLElement | null) ??
          document.body
        host.appendChild(popup)

        root = createRoot(popup)
        root.render(
          React.createElement(Component, {
            ref: (r: SuggestionPopupRef | null) => {
              componentRef = r
            },
            items: props.items,
            command: (item: TItem) => props.command(item),
          }),
        )

        updatePosition(popup, props)
      },

      onUpdate(props: SuggestionProps<TItem>) {
        root?.render(
          React.createElement(Component, {
            ref: (r: SuggestionPopupRef | null) => {
              componentRef = r
            },
            items: props.items,
            command: (item: TItem) => props.command(item),
          }),
        )
        if (popup) updatePosition(popup, props)
      },

      onKeyDown(props: SuggestionKeyDownProps) {
        if (props.event.key === 'Escape') {
          cleanup()
          return true
        }
        return componentRef?.onKeyDown(props) ?? false
      },

      onExit() {
        cleanup()
      },
    }

    function updatePosition(el: HTMLDivElement, props: SuggestionProps<TItem>) {
      const caretRect = props.clientRect?.()
      if (!caretRect) return
      const editorRect = (props.editor.view.dom as HTMLElement).getBoundingClientRect()
      const hostRect =
        host === document.body ? { left: 0, top: 0 } : host.getBoundingClientRect()
      el.style.position = 'fixed'
      el.style.left = `${editorRect.left - hostRect.left}px`
      el.style.width = `${editorRect.width}px`
      el.style.bottom = `${window.innerHeight - caretRect.top - hostRect.top + 6}px`
      el.style.zIndex = '999'
    }

    function cleanup() {
      root?.unmount()
      root = null
      popup?.remove()
      popup = null
      componentRef = null
    }
  }
}

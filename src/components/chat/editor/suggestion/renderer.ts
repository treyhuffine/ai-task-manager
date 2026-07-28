'use client'

import React, {
  type ForwardRefExoticComponent,
  type RefAttributes,
} from 'react'
import { createRoot, type Root } from 'react-dom/client'
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

export interface SuggestionPopupRendererOptions {
  popupClassName?: string
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
    let host: HTMLElement = document.body
    let releaseEscape: (() => void) | null = null
    // Escape closes the menu for the rest of the current token. The
    // Tiptap plugin stays active on purpose — force-exiting it would
    // let the very next keystroke re-match `#1` → `#12` and pop the
    // menu straight back open, which is the opposite of dismissing.
    // `onExit` clears the flag once the match breaks, so the next `#`
    // opens normally.
    let dismissed = false

    return {
      onStart(props: SuggestionProps<TItem>) {
        dismissed = false
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

        releaseEscape?.()
        releaseEscape = registerOpenSuggestion({
          dismiss,
          isFocused: () => props.editor.view.hasFocus(),
        })
      },

      onUpdate(props: SuggestionProps<TItem>) {
        if (dismissed) return
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

    function dismiss() {
      if (dismissed) return
      dismissed = true
      cleanup()
      options?.onDismiss?.()
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

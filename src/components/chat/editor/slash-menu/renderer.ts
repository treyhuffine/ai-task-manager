'use client'

import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import { SlashMenuList, type SlashMenuListRef } from './popup'
import type { SkillCommandDescriptor } from './types'

/**
 * Tiptap Suggestion `render` factory for the slash menu. Mounts a small
 * React tree into the DOM rather than using a Tiptap floating element so
 * we can keep the popup styled with the app's shadcn classes and properly
 * positioned even when the composer lives inside a transformed ancestor
 * (Radix Dialog, Popover, etc.).
 *
 * Lifted from `src/components/editor/slash-commands.tsx:261-352`. The
 * positioning math handles transformed ancestors by subtracting the host
 * element's bounding rect from the caret's viewport-relative rect.
 */
export function createSuggestionRenderer() {
  return () => {
    let popup: HTMLDivElement | null = null
    let root: Root | null = null
    let componentRef: SlashMenuListRef | null = null
    let host: HTMLElement = document.body

    return {
      onStart(props: SuggestionProps<SkillCommandDescriptor>) {
        popup = document.createElement('div')
        popup.className = 'slash-command-popup'
        // Mount inside the nearest Radix Dialog when present — Radix sets
        // pointer-events: none on body siblings of a modal dialog, which would
        // otherwise block clicks and scrollbar drags on the menu.
        const editorDom = props.editor.view.dom as HTMLElement
        host =
          (editorDom.closest('[role="dialog"]') as HTMLElement | null) ??
          (editorDom.closest('[data-radix-popper-content-wrapper]') as HTMLElement | null) ??
          document.body
        host.appendChild(popup)

        root = createRoot(popup)
        root.render(
          React.createElement(SlashMenuList, {
            ref: (r: SlashMenuListRef | null) => { componentRef = r },
            items: props.items,
            command: (item: SkillCommandDescriptor) => props.command(item),
          }),
        )

        updatePosition(popup, props)
      },

      onUpdate(props: SuggestionProps<SkillCommandDescriptor>) {
        root?.render(
          React.createElement(SlashMenuList, {
            ref: (r: SlashMenuListRef | null) => { componentRef = r },
            items: props.items,
            command: (item: SkillCommandDescriptor) => props.command(item),
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

    function updatePosition(
      el: HTMLDivElement,
      props: SuggestionProps<SkillCommandDescriptor>,
    ) {
      const caretRect = props.clientRect?.()
      if (!caretRect) return
      const editorRect = (props.editor.view.dom as HTMLElement).getBoundingClientRect()
      const hostRect =
        host === document.body
          ? { left: 0, top: 0 }
          : host.getBoundingClientRect()
      // Constrain the popup to the composer's horizontal footprint so it
      // doesn't run wider than the textarea (matches Conductor's behavior).
      // Vertical: anchor above the caret since chat composers typically
      // sit at the bottom of their viewport.
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

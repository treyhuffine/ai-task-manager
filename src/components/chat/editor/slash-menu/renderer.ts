'use client'

import { createSuggestionPopupRenderer } from '../suggestion/renderer'
import { SlashMenuList } from './popup'
import type { CommandMatch } from './ranking'

/**
 * Tiptap Suggestion `render` factory for the slash menu. Thin wrapper
 * around `createSuggestionPopupRenderer` — the renderer is shared with
 * the @-mention and #-mention menus so popup positioning, mount-host
 * handling, and lifecycle stay in one place.
 */
export function createSuggestionRenderer() {
  return createSuggestionPopupRenderer<CommandMatch>(SlashMenuList)
}

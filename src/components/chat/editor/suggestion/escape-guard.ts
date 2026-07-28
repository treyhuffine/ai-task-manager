'use client'

/**
 * Escape handling for the composer's suggestion menus (`/`, `@`, `#`).
 *
 * Escape is the universal "I didn't mean that" key, so it should close
 * an open menu and nothing else. Getting there takes one trick: the
 * composer often lives inside a Radix dialog (the task and note
 * slideouts), and Radix's DismissableLayer listens on `document` in the
 * *capture* phase. That fires long before ProseMirror's own handler, so
 * a menu that only handles Escape inside the Tiptap plugin would close
 * the menu and tear down the surrounding slideout with it.
 *
 * Listeners on `window` run ahead of listeners on `document` during
 * capture no matter what order they were registered in, so a single
 * window-capture handler reliably wins the race. When a menu is open we
 * consume the key there: `preventDefault()` makes Radix skip its
 * dismiss (it bails on `event.defaultPrevented`) and `stopPropagation()`
 * keeps the app's other Escape listeners (slideouts, side panes, search
 * overlay) from reacting to a keypress that was meant for the menu.
 *
 * When no menu is open the handler does nothing, so Escape keeps its
 * normal meaning everywhere else.
 */

export interface OpenSuggestion {
  /** Close the menu. Safe to call more than once. */
  dismiss: () => void
  /**
   * Whether this menu should claim the key. A menu whose editor has
   * lost focus stays out of the way, so Escape can still close the
   * dialog the user is actually looking at.
   */
  isFocused: () => boolean
}

const openMenus = new Set<OpenSuggestion>()

/**
 * Which open menus (if any) should swallow this keypress. Pure so the
 * decision is testable without a DOM: an empty result means "not ours,
 * let the event through untouched".
 */
export function escapeClaimants(
  event: { key: string; isComposing?: boolean },
  menus: Iterable<OpenSuggestion>,
): OpenSuggestion[] {
  if (event.key !== 'Escape' && event.key !== 'Esc') return []
  // Mid-composition Escape belongs to the IME (it cancels the
  // in-progress candidate), not to the menu.
  if (event.isComposing) return []
  return [...menus].filter((menu) => menu.isFocused())
}

function handleKeyDown(event: KeyboardEvent): void {
  const claimants = escapeClaimants(event, openMenus)
  if (claimants.length === 0) return
  event.preventDefault()
  event.stopPropagation()
  for (const menu of claimants) menu.dismiss()
}

/**
 * Mark a menu as open. Returns a release function — call it when the
 * menu closes for any reason. The window listener only exists while at
 * least one menu is registered.
 */
export function registerOpenSuggestion(menu: OpenSuggestion): () => void {
  if (openMenus.size === 0 && typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeyDown, { capture: true })
  }
  openMenus.add(menu)

  let released = false
  return () => {
    if (released) return
    released = true
    openMenus.delete(menu)
    if (openMenus.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }
}

/** Test seam: how many menus currently claim Escape. */
export function openSuggestionCount(): number {
  return openMenus.size
}

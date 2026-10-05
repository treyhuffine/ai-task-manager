/**
 * The action row at the top of a task or note (its slideout and its full page)
 * is a container, so its buttons can fit the room it actually has. A phone shows
 * the slideout at full width whatever width it was dragged to on the desktop, so
 * the stored width can't tell.
 */
export const ENTITY_HEADER = '@container/entityhead'

/**
 * A header button's words. They drop once the row is too narrow for them,
 * leaving the icon (each button keeps its name as a tooltip and aria-label),
 * rather than wrapping a label onto two lines.
 */
export const ENTITY_HEADER_LABEL = '@max-[36rem]/entityhead:hidden'

/** The Agent / Document toggle needs more room for its words than one button. */
export const ENTITY_HEADER_TOGGLE_LABEL = '@max-[44rem]/entityhead:hidden'

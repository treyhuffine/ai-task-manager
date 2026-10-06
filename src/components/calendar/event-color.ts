import type { CSSProperties } from 'react';

/**
 * A meeting's color as a stripe down its left edge (docs/calendar-view-spec.md,
 * "Calendars and colors"): its calendar's color, or its own. The card itself
 * stays neutral, so meetings never read as an agent's work, which owns the
 * filled colors in the same view. An inset shadow, so it follows the card's
 * corners and moves nothing.
 */
export function stripeStyle(color: string | null | undefined, width = 3): CSSProperties | undefined {
  return color ? { boxShadow: `inset ${width}px 0 0 ${color}` } : undefined;
}

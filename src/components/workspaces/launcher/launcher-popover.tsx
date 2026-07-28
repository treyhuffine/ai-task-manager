'use client';

import { Popover as PopoverPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

/**
 * Popover content for surfaces rendered *inside* the launcher dialog.
 *
 * Identical in appearance to the shared `ui/popover`, with one structural
 * difference: it does **not** portal to `document.body`.
 *
 * Radix Dialog locks background scrolling with `react-remove-scroll`, passing
 * `shards: [contentRef]` — only the dialog's own DOM subtree is exempt. A
 * popover portaled to the body therefore sits outside the shard, and every
 * wheel/trackpad event over it gets swallowed by the lock. Dragging the
 * scrollbar still worked because that isn't a wheel event, which is exactly
 * how the bug presented: "scrolls when you grab the bar, not with two fingers."
 *
 * Rendering in-tree puts the content inside the shard, so wheel events reach
 * it. It doesn't reintroduce the clipping this originally portaled to escape,
 * because Radix's popper positions with `strategy: "fixed"` — a fixed element
 * whose containing block is the viewport is not clipped by an ancestor's
 * `overflow: hidden`.
 *
 * That guarantee holds only while NO ancestor inside the dialog creates a
 * containing block for fixed descendants. `transform`, `filter`, `perspective`,
 * `backdrop-filter`, and `will-change` all do. This is why the launcher's
 * `Dialog.Content` centers with `inset-x-0 mx-auto` instead of
 * `left-1/2 -translate-x-1/2`, and why its open/close animations live on the
 * inner panel rather than on `Dialog.Content` itself. Reintroducing a transform
 * on that element will silently re-clip every popover in the launcher.
 */
export function LauncherPopoverContent({
  className,
  align = 'center',
  sideOffset = 6,
  style,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Content
      data-slot="popover-content"
      align={align}
      sideOffset={sideOffset}
      collisionPadding={12}
      // Cap against the space the popper actually has, so a long list scrolls
      // internally instead of running off the top or bottom of the viewport.
      style={{ maxHeight: 'min(60vh, var(--radix-popover-content-available-height))', ...style }}
      className={cn(
        'z-50 w-72 overflow-y-auto overscroll-contain rounded-lg border border-border bg-card p-3 shadow-lg outline-none',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  );
}

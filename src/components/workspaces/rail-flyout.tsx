'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { useDashboard } from '@/contexts/dashboard-context';
import { viewKey } from '@/lib/client/active-view';
import { nextFlyoutState, type FlyoutEvent, type FlyoutState } from '@/lib/client/rail-flyout';
import { cn } from '@/lib/utils';
import { RailIconButton } from './rail-icon-button';

/** How long the pointer rests on the trigger before the flyout peeks. */
const OPEN_DELAY_MS = 150;
/** How long a peek survives the pointer leaving, to cross into it. */
const CLOSE_DELAY_MS = 200;

/**
 * A rail button whose list floats over the page beside the rail (Agents in
 * the strip, Apps in both rails). Resting the pointer on it peeks; pressing
 * anything inside, or clicking the trigger, holds it open
 * (src/lib/client/rail-flyout.ts). Esc, a click outside, or going anywhere
 * closes it.
 *
 * Built on Radix Popover for the dismiss rules: a row's menu or a dialog
 * opened from inside sits above it as a nested layer, so Esc and clicks there
 * close that first and leave the flyout be. It floats beside the whole rail,
 * top to bottom, rather than beside the trigger.
 *
 * `trigger` draws the button. It gets the ref the flyout measures and
 * returns focus to, and whether the flyout is open, so it can hide its
 * tooltip and show itself as pressed.
 *
 * With `onClick`, a click goes there instead of holding the flyout (the Apps
 * row opens the library), and the flyout is a hover peek only: it shows while
 * the pointer is on the trigger or inside it, and hides when it leaves.
 *
 * `anchor` is where it hangs: `rail` runs the rail's full height beside it
 * (the Agents list, which can be long), `trigger` starts level with the
 * button and is as tall as its content (the Apps menu), so it reads as the
 * row's own menu rather than a second column.
 */
export function RailFlyout({
  contentLabel,
  trigger,
  onClick,
  anchor = 'rail',
  children,
}: {
  /** The flyout's accessible name. */
  contentLabel: string;
  trigger: (props: { ref: RefObject<HTMLButtonElement | null>; open: boolean }) => ReactElement;
  /** Where a click goes, when it doesn't hold the flyout. */
  onClick?: () => void;
  anchor?: 'rail' | 'trigger';
  children: ReactNode;
}) {
  const { activeView } = useDashboard();
  const [state, setState] = useState<FlyoutState>(null);
  const dispatch = useCallback((event: FlyoutEvent) => setState((prev) => nextFlyoutState(prev, event)), []);
  const open = state !== null;

  // One pending intent at a time: a peek about to open, or about to close.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const after = useCallback(
    (event: FlyoutEvent, ms: number) => {
      cancel();
      timer.current = setTimeout(() => {
        timer.current = null;
        dispatch(event);
      }, ms);
    },
    [cancel, dispatch],
  );
  useEffect(() => cancel, [cancel]);

  // Going anywhere closes it: what you picked is on screen now.
  const view = viewKey(activeView);
  const [shownOn, setShownOn] = useState(view);
  if (shownOn !== view) {
    setShownOn(view);
    setState(null);
  }

  // Opened from the keyboard, focus goes in, and back to the trigger after.
  // Kept past the close, when the state is already null.
  const openedByKeyboard = useRef(false);
  useEffect(() => {
    if (state) openedByKeyboard.current = state.keyboard;
  }, [state]);

  const button = useRef<HTMLButtonElement>(null);
  // The anchor is measured when Radix asks, so one stable object for the
  // whole life of the flyout: the rail's edge, at the rail's height or the
  // trigger's. `anchor` doesn't change for a given trigger.
  const [railEdge] = useState(() => ({
    getBoundingClientRect: () => {
      const rail = (button.current?.closest('aside') ?? button.current)?.getBoundingClientRect();
      if (!rail) return new DOMRect();
      if (anchor === 'rail') return rail;
      const row = button.current?.getBoundingClientRect() ?? rail;
      return new DOMRect(rail.left, row.top, rail.width, row.height);
    },
  }));

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          cancel();
          dispatch({ type: 'dismiss' });
        }
      }}
    >
      <PopoverPrimitive.Trigger
        asChild
        onClick={(e) => {
          // Ours, not Radix's toggle: a click on a peek holds it, or goes
          // where the trigger goes and the peek closes behind it.
          e.preventDefault();
          cancel();
          if (onClick) {
            dispatch({ type: 'dismiss' });
            onClick();
            return;
          }
          dispatch({ type: 'click', keyboard: e.detail === 0 });
        }}
        onPointerEnter={(e) => {
          if (e.pointerType !== 'mouse') return;
          if (open) cancel();
          else after({ type: 'hover' }, OPEN_DELAY_MS);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') after({ type: 'leave' }, CLOSE_DELAY_MS);
        }}
      >
        {trigger({ ref: button, open })}
      </PopoverPrimitive.Trigger>
      {/* After the trigger, on purpose. Until Radix sees this anchor, it wraps
          the trigger in an anchor of its own, and of two anchors the last to
          register wins. Placed first, the trigger's wins, then goes stale when
          the trigger remounts unwrapped, and the flyout measures a detached
          button: zero size, at 0,0. */}
      <PopoverPrimitive.Anchor virtualRef={{ current: railEdge }} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="right"
          align="start"
          sideOffset={0}
          avoidCollisions={anchor === 'trigger'}
          collisionPadding={8}
          aria-label={contentLabel}
          onOpenAutoFocus={(e) => {
            if (!state?.keyboard) e.preventDefault();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (openedByKeyboard.current) button.current?.focus();
          }}
          // Focus wandering off (a toast, a dialog elsewhere) isn't a reason
          // to close. A click outside or Esc is.
          onFocusOutside={(e) => e.preventDefault()}
          onPointerEnter={(e) => {
            if (e.pointerType === 'mouse') cancel();
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse') after({ type: 'leave' }, CLOSE_DELAY_MS);
          }}
          onPointerDownCapture={() => {
            cancel();
            dispatch({ type: 'press' });
          }}
          className={cn(
            'z-50 flex w-[256px] flex-col bg-background shadow-xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-left-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
            anchor === 'rail'
              ? 'h-[var(--radix-popper-anchor-height)] border-r border-border'
              : 'max-h-[min(70vh,520px)] rounded-r-xl border border-l-0 border-border',
          )}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/** A flyout from one of the collapsed strip's icon buttons. */
export function StripFlyout({
  icon,
  mark,
  label,
  contentLabel,
  active = false,
  badge,
  onClick,
  anchor,
  children,
}: {
  icon?: LucideIcon;
  mark?: ReactNode;
  /** The button's tooltip and accessible name. */
  label: string;
  contentLabel: string;
  active?: boolean;
  badge?: ReactNode;
  onClick?: () => void;
  anchor?: 'rail' | 'trigger';
  children: ReactNode;
}) {
  return (
    <RailFlyout
      contentLabel={contentLabel}
      onClick={onClick}
      anchor={anchor}
      trigger={({ ref, open }) => (
        <RailIconButton ref={ref} icon={icon} mark={mark} label={label} hideTip={open} active={active || open} badge={badge} />
      )}
    >
      {children}
    </RailFlyout>
  );
}

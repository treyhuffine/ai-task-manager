'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode, type Ref, type RefObject } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { useDashboard } from '@/contexts/dashboard-context';
import { viewKey } from '@/lib/client/active-view';
import { nextFlyoutState, type FlyoutEvent, type FlyoutState } from '@/lib/client/rail-flyout';
import { RailIconButton } from './rail-icon-button';

/** How long the pointer rests on the trigger before the flyout peeks. */
const OPEN_DELAY_MS = 150;
/** How long a peek survives the pointer leaving, to cross into it. */
const CLOSE_DELAY_MS = 200;

const RailFlyoutDismissContext = createContext<(() => void) | null>(null);

/** A row selection closes its nearest chooser even when that chat is already open. */
export function useDismissRailFlyout() {
  return useContext(RailFlyoutDismissContext);
}

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
 */
export function RailFlyout({
  contentLabel,
  trigger,
  onClick,
  hoverTarget,
  children,
}: {
  /** The flyout's accessible name. */
  contentLabel: string;
  trigger: (props: { ref: Ref<HTMLButtonElement>; open: boolean }) => ReactElement;
  /** Where a click goes, when it doesn't hold the flyout. */
  onClick?: () => void;
  /** Hover the whole row while keeping its name button as the accessible trigger. */
  hoverTarget?: RefObject<HTMLElement | null>;
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
  const dismiss = useCallback(() => {
    cancel();
    dispatch({ type: 'dismiss' });
  }, [cancel, dispatch]);

  useEffect(() => {
    const target = hoverTarget?.current;
    if (!target) return;
    const enter = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      if (e.relatedTarget instanceof Node && target.contains(e.relatedTarget)) return;
      if (open) cancel();
      else after({ type: 'hover' }, OPEN_DELAY_MS);
    };
    const leave = (e: PointerEvent) => {
      if (e.relatedTarget instanceof Node && target.contains(e.relatedTarget)) return;
      if (e.pointerType === 'mouse') after({ type: 'leave' }, CLOSE_DELAY_MS);
    };
    // Clicking an action or starting a drag cancels any pending hover.
    const press = () => {
      cancel();
      dispatch({ type: 'dismiss' });
    };
    // These run before React synthesizes the content's pointerenter from
    // pointerout. Native pointerleave runs after it and would rearm a close
    // that entering the flyout just cancelled.
    target.addEventListener('pointerover', enter);
    target.addEventListener('pointerout', leave);
    target.addEventListener('pointerdown', press);
    return () => {
      target.removeEventListener('pointerover', enter);
      target.removeEventListener('pointerout', leave);
      target.removeEventListener('pointerdown', press);
    };
  }, [hoverTarget, open, cancel, after, dispatch]);

  // Going anywhere closes it: what you picked is on screen now.
  const view = viewKey(activeView);
  useEffect(() => cancel(), [view, cancel]);
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
  const content = useRef<HTMLDivElement>(null);
  // The anchor is measured when Radix asks, so one stable object for the
  // whole life of the flyout: the rail's edge, at its full height. A nested
  // chat chooser uses the containing Agents flyout's edge and height.
  const [railEdge] = useState(() => ({
    getBoundingClientRect: () => {
      return (button.current?.closest('[data-rail-flyout], aside') ?? button.current)?.getBoundingClientRect() ?? new DOMRect();
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
          if (hoverTarget) return;
          if (e.pointerType !== 'mouse') return;
          if (open) cancel();
          else after({ type: 'hover' }, OPEN_DELAY_MS);
        }}
        onPointerLeave={(e) => {
          if (hoverTarget) return;
          if (e.pointerType === 'mouse') after({ type: 'leave' }, CLOSE_DELAY_MS);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowRight') return;
          e.preventDefault();
          e.stopPropagation();
          cancel();
          dispatch({ type: 'keyboard' });
          content.current?.querySelector<HTMLElement>('button, [tabindex="0"], a[href]')?.focus();
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
          ref={content}
          side="right"
          align="start"
          sideOffset={0}
          avoidCollisions={false}
          aria-label={contentLabel}
          data-rail-flyout=""
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
          // Portals still bubble through the agent's draggable header.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className="z-50 flex h-[var(--radix-popper-anchor-height)] w-[256px] flex-col border-r border-border bg-background shadow-xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-left-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
        >
          <RailFlyoutDismissContext.Provider value={dismiss}>
            {children}
          </RailFlyoutDismissContext.Provider>
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
  children: ReactNode;
}) {
  return (
    <RailFlyout
      contentLabel={contentLabel}
      onClick={onClick}
      trigger={({ ref, open }) => (
        <RailIconButton ref={ref} icon={icon} mark={mark} label={label} hideTip={open} active={active || open} badge={badge} />
      )}
    >
      {children}
    </RailFlyout>
  );
}

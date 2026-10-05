'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, PanelLeftOpen } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { useDashboard } from '@/contexts/dashboard-context';
import { useAgentAttention } from '@/hooks/use-agent-attention';
import { useSessionBuckets } from '@/hooks/use-session-buckets';
import { HOTKEYS } from '@/constants/commands';
import { nextFlyoutState, type FlyoutEvent, type FlyoutState } from '@/lib/client/rail-flyout';
import { useRailTab } from '@/lib/client/rail-tab';
import type { ActiveView } from '@/types/dashboard';
import { RailHome } from './rail-home';
import { RailFooter } from './rail-footer';
import { RailIconButton, RailStripActions, StripDivider, type RailPlace } from './rail-nav';
import { RailListBody, RailTabSwitch } from './rail-list';
import { SessionHoverProvider } from './session-hover-context';

/** How long the pointer rests on Agents before the flyout peeks. */
const OPEN_DELAY_MS = 150;
/** How long a peek survives the pointer leaving, to cross into it. */
const CLOSE_DELAY_MS = 200;

/**
 * The collapsed rail, 44px wide: the wide rail's buttons as icons in the same
 * order (home, places, Create and Search), then one Agents button where the
 * list would be, and Settings at the foot.
 *
 * Executions aren't listed here. Agents opens the wide rail's list (Agents |
 * Recent, pins and all) in a flyout that floats over the page, so a glance at
 * your work never pushes the page. `onToggle` widens the rail for good, and is
 * absent where the rail stays collapsed (tablets).
 */
export function RailStrip({ places, onToggle }: { places: readonly RailPlace[]; onToggle?: () => void }) {
  return (
    <div className="flex h-full w-[44px] flex-col">
      <RailHome collapsed />
      <div className="flex min-h-0 flex-1 flex-col items-center gap-0.5 overflow-y-auto overflow-x-hidden pb-2">
        {onToggle && (
          <RailIconButton
            icon={PanelLeftOpen}
            label={`Expand rail (${HOTKEYS.toggleRail.label})`}
            aria-label="Expand rail"
            onClick={onToggle}
          />
        )}
        <StripDivider />
        <RailStripActions places={places} />
        <StripDivider />
        <AgentsFlyout />
      </div>
      <RailFooter collapsed />
    </div>
  );
}

/**
 * The Agents button and its flyout. Resting the pointer on it peeks; pressing
 * anything inside, or clicking the button, holds it open (src/lib/client/
 * rail-flyout.ts). Esc, a click outside, or going anywhere closes it.
 *
 * Built on Radix Popover for the dismiss rules: a row's menu or a dialog
 * opened from inside sits above it as a nested layer, so Esc and clicks there
 * close that first and leave the flyout be. It floats beside the whole rail,
 * top to bottom, rather than beside the button.
 *
 * Rows list executions by name with their status, no chat preview on hover.
 * The badge counts what needs you (approvals and unread, agents included), the
 * same rows the header's pills count.
 */
function AgentsFlyout() {
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

  // Opened from the keyboard, focus goes in, and back to the button after.
  // Kept past the close, when the state is already null.
  const openedByKeyboard = useRef(false);
  useEffect(() => {
    if (state) openedByKeyboard.current = state.keyboard;
  }, [state]);

  const button = useRef<HTMLButtonElement>(null);
  const railEdge = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () =>
          (button.current?.closest('aside') ?? button.current)?.getBoundingClientRect() ?? new DOMRect(),
      },
    }),
    [],
  );

  const buckets = useSessionBuckets();
  const agents = useAgentAttention();
  const needsYou = agents.length + buckets.needsApproval.length + buckets.unread.length;
  const label = needsYou > 0 ? `Agents: ${needsYou} need${needsYou === 1 ? 's' : ''} you` : 'Agents';
  const inWork = activeView.kind === 'agent' || activeView.kind === 'execution';

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
          // Ours, not Radix's toggle: a click on a peek holds it.
          e.preventDefault();
          cancel();
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
        <RailIconButton
          ref={button}
          icon={Bot}
          label={label}
          title={open ? undefined : label}
          active={inWork || open}
          badge={
            needsYou > 0 ? (
              <span
                aria-hidden
                className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-[3px] rounded-full bg-amber-500 text-white text-[9px] font-semibold leading-[14px] text-center tabular-nums ring-2 ring-background"
              >
                {needsYou > 9 ? '9+' : needsYou}
              </span>
            ) : undefined
          }
        />
      </PopoverPrimitive.Trigger>
      {/* After the trigger, on purpose. Until Radix sees this anchor, it wraps
          the trigger in an anchor of its own, and of two anchors the last to
          register wins. Placed first, the trigger's wins, then goes stale when
          the trigger remounts unwrapped, and the flyout measures a detached
          button: zero size, at 0,0. */}
      <PopoverPrimitive.Anchor virtualRef={railEdge} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="right"
          align="start"
          sideOffset={0}
          avoidCollisions={false}
          aria-label="Agents"
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
          className="z-50 flex h-[var(--radix-popper-anchor-height)] w-[256px] flex-col border-r border-border bg-background shadow-xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-left-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
        >
          <SessionHoverProvider disabled>
            <FlyoutList />
          </SessionHoverProvider>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/** The tabs fixed at the top, the list scrolling under them. */
function FlyoutList() {
  const { tab, setTab } = useRailTab();
  return (
    <>
      <RailTabSwitch tab={tab} onSelect={setTab} />
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-4">
        <RailListBody tab={tab} />
      </div>
    </>
  );
}

function viewKey(view: ActiveView): string {
  switch (view.kind) {
    case 'home':
      return 'home';
    case 'skill':
      return `skill:${view.ref}`;
    case 'agent':
    case 'execution':
      return `${view.kind}:${view.id}`;
  }
}

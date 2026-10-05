'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { PanelLeftClose } from 'lucide-react';
import { HOTKEYS } from '@/constants/commands';
import { useRailTab } from '@/lib/client/rail-tab';
import { TriggersModal } from '@/components/triggers/triggers-modal';
import { RailHome } from './rail-home';
import { RailFooter } from './rail-footer';
import { RailIconButton, RailPlaceRows, RailVerbButtons, useRailPlaces, type RailPlace } from './rail-nav';
import { RailListBody, RailTabSwitch } from './rail-list';
import { RailStrip } from './rail-strip';
import { SessionHoverProvider } from './session-hover-context';
import { SessionHoverPreview } from './session-hover-preview';

/**
 * The left rail (docs/rail.md), wide or collapsed. Top to bottom:
 *
 *   - **Home**: the orchestrator by name, the way home, with the collapse
 *     toggle at its right (`RailHome`). Fixed.
 *   - **Places**: Board, Calendar, Schedules and Triggers (`rail-nav.tsx`).
 *     They scroll away with the list.
 *   - **Create and Search**, then the **Agents | Recent** tabs. Sticky under
 *     the home row once the places have scrolled off.
 *   - **The list**: pins, then the agent tree or the recent feed
 *     (`rail-list.tsx`).
 *   - **Footer**: Settings and Connect apps (`RailFooter`). Fixed.
 *
 * Collapsed, the same buttons fold to icons in the same order and the list
 * becomes one Agents button whose flyout floats over the page (`RailStrip`).
 * `onToggle` is absent where the rail can't widen (tablets).
 */
export function Rail({ expanded, onToggle }: { expanded: boolean; onToggle?: () => void }) {
  const [schedulesOpen, setSchedulesOpen] = useState(false);
  const places = useRailPlaces({ schedulesOpen, onOpenSchedules: () => setSchedulesOpen(true) });
  return (
    <>
      {expanded ? <WideRail places={places} onToggle={onToggle} /> : <RailStrip places={places} onToggle={onToggle} />}
      <TriggersModal open={schedulesOpen} onClose={() => setSchedulesOpen(false)} />
    </>
  );
}

function WideRail({ places, onToggle }: { places: readonly RailPlace[]; onToggle?: () => void }) {
  const { tab, setTab } = useRailTab();
  // The list's own sticky toolbar (selecting executions to archive) pins
  // under this block, so the block's height is published to it.
  const sticky = useRef<HTMLDivElement>(null);
  const stickyHeight = useHeight(sticky);

  return (
    <SessionHoverProvider>
      <div className="flex h-full flex-col">
        <RailHome
          collapsed={false}
          action={
            onToggle && (
              <RailIconButton
                icon={PanelLeftClose}
                label={`Collapse rail (${HOTKEYS.toggleRail.label})`}
                aria-label="Collapse rail"
                onClick={onToggle}
              />
            )
          }
        />
        <div
          className="min-h-0 flex-1 overflow-y-auto pb-4"
          style={{ '--rail-sticky-top': `${stickyHeight}px` } as CSSProperties}
        >
          <RailPlaceRows places={places} />
          <div ref={sticky} className="sticky top-0 z-30 bg-background">
            <RailVerbButtons />
            <RailTabSwitch tab={tab} onSelect={setTab} />
          </div>
          <RailListBody tab={tab} />
        </div>
        <RailFooter collapsed={false} />
      </div>
      <SessionHoverPreview />
    </SessionHoverProvider>
  );
}

function useHeight(ref: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return height;
}

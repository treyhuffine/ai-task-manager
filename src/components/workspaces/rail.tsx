'use client';

import { useState } from 'react';
import { PanelLeftClose } from 'lucide-react';
import { HOTKEYS } from '@/constants/commands';
import { useRailTab } from '@/lib/client/rail-tab';
import { TriggersModal } from '@/components/triggers/triggers-modal';
import { RailHome } from './rail-home';
import { RailFooter } from './rail-footer';
import { RailIconButton, RailPlaceRows, RailVerbRows, useRailPlaces, type RailPlace } from './rail-nav';
import { RailListBody, RailListHeader } from './rail-list';
import { RailStrip } from './rail-strip';
import { SessionHoverProvider } from './session-hover-context';
import { SessionHoverPreview } from './session-hover-preview';
import { WorkspaceSelectionProvider } from './workspace-selection-context';

/**
 * The left rail (docs/rail.md), wide or collapsed. Top to bottom:
 *
 *   - **Home**: the orchestrator by name, the way home, with the collapse
 *     toggle at its right (`RailHome`). Fixed.
 *   - **New execution, Search chats**: rows, fixed under the home row
 *     (`rail-nav.tsx`).
 *   - **Places**: Apps, Task Board, Calendar, Schedules and Triggers. Rows that
 *     scroll away with the list. Apps opens your apps beside the rail.
 *   - **The list header**: Agents | Recent as the list's title, with the
 *     list's actions. Sticky at the top once the places have scrolled off.
 *   - **The list**: pins, then the agent tree or the recent feed
 *     (`rail-list.tsx`).
 *   - **Footer**: Settings and Connect accounts (`RailFooter`). Fixed.
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
  return (
    <SessionHoverProvider>
      <WorkspaceSelectionProvider>
        <div className="flex h-full flex-col">
          <RailHome
            collapsed={false}
            action={
              onToggle && (
                <RailIconButton
                  icon={PanelLeftClose}
                  label="Collapse rail"
                  shortcut={HOTKEYS.toggleRail.label}
                  onClick={onToggle}
                />
              )
            }
          />
          <RailVerbRows />
          <div aria-hidden className="mx-3 h-px flex-shrink-0 bg-border/50" />
          <div className="min-h-0 flex-1 overflow-y-auto pb-4">
            <RailPlaceRows places={places} />
            <div className="sticky top-0 z-30 bg-background">
              <RailListHeader tab={tab} onSelect={setTab} />
            </div>
            <RailListBody tab={tab} />
          </div>
          <RailFooter collapsed={false} />
        </div>
      </WorkspaceSelectionProvider>
      <SessionHoverPreview />
    </SessionHoverProvider>
  );
}

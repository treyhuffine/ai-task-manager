'use client';

import { RailLayout } from '@/components/home/home-navigation';
import { PanelLeftClose } from 'lucide-react';
import { HOTKEYS } from '@/constants/commands';
import { useRailTab } from '@/lib/client/rail-tab';
import { openSchedulesWindow, useSchedulesWindow } from '@/lib/client/schedules-window';
import { RailHome } from './rail-home';
import { RailFooter } from './rail-footer';
import { RailIconButton, RailPlaceRows, RailVerbRows, useRailPlaces, type RailPlace } from './rail-nav';
import { RailListBody, RailListHeader } from './rail-list';
import { RailStrip } from './rail-strip';
import { SessionHoverProvider } from './session-hover-context';
import { SessionHoverPreview } from './session-hover-preview';
import { WorkspaceSelectionProvider } from './workspace-selection-context';
import { AppsReviewRailSlot } from '@/components/local-apps/layout-review/rail-portal';

/**
 * The left rail (docs/rail.md), wide or collapsed. Top to bottom:
 *
 *   - **Home**: the orchestrator by name, the way home, with the collapse
 *     toggle at its right (`RailHome`). Fixed.
 *   - **New execution, Search chats**: rows, fixed under the home row
 *     (`rail-nav.tsx`).
 *   - **Places**: Apps, Board, Calendar, Schedules and Triggers. Rows that
 *     scroll away with the list. Apps opens your apps beside the rail.
 *   - **The list header**: the Agents | Recent switch as the list's title,
 *     with the list's actions. Sticky at the top once the places have
 *     scrolled off.
 *   - **The list**: pins, then the agent tree or the recent feed
 *     (`rail-list.tsx`).
 *   - **Footer**: Settings and Connect accounts (`RailFooter`). Fixed.
 *
 * Collapsed, the same buttons fold to icons in the same order and the list
 * becomes one Agents button whose flyout floats over the page (`RailStrip`).
 * `onToggle` is absent where the rail can't widen (tablets).
 */
export function Rail({ expanded, onToggle }: { expanded: boolean; onToggle?: () => void }) {
  const schedulesOpen = useSchedulesWindow().open;
  const places = useRailPlaces({ schedulesOpen, onOpenSchedules: () => openSchedulesWindow() });
  return expanded ? <WideRail places={places} onToggle={onToggle} /> : <RailStrip places={places} onToggle={onToggle} />;
}

function WideRail({ places, onToggle }: { places: readonly RailPlace[]; onToggle?: () => void }) {
  const { tab, setTab } = useRailTab();
  return (
    <SessionHoverProvider>
      <WorkspaceSelectionProvider>
        <RailLayout header={
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
          } actions={<RailVerbRows />} footer={<RailFooter collapsed={false}/>} >


            <RailPlaceRows places={places} />
            <AppsReviewRailSlot>
              <div className="sticky top-0 z-30 bg-background">
                <RailListHeader tab={tab} onSelect={setTab} />
              </div>
              <RailListBody tab={tab} />
            </AppsReviewRailSlot>
        </RailLayout>
      </WorkspaceSelectionProvider>
      <SessionHoverPreview />
    </SessionHoverProvider>
  );
}

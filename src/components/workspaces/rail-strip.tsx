'use client';

import { Bot, PanelLeftOpen } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useAgentAttention } from '@/hooks/use-agent-attention';
import { useSessionBuckets } from '@/hooks/use-session-buckets';
import { HOTKEYS } from '@/constants/commands';
import { useRailTab } from '@/lib/client/rail-tab';
import { RailHome } from './rail-home';
import { RailFooter } from './rail-footer';
import { StripFlyout } from './rail-flyout';
import { RailIconButton } from './rail-icon-button';
import { RailStripActions, StripDivider, type RailPlace } from './rail-nav';
import { RailListBody, RailListHeader } from './rail-list';
import { SessionHoverProvider } from './session-hover-context';
import { WorkspaceSelectionProvider } from './workspace-selection-context';

/**
 * The collapsed rail, 44px wide: the wide rail's buttons as icons in the same
 * order (home, New execution and Search chats, then the places), then one
 * Agents button where the list would be, and Settings at the foot.
 *
 * Executions aren't listed here. Agents opens the wide rail's list (Agents |
 * Recent, pins and all) in a flyout that floats over the page, so a glance at
 * your work never pushes the page. Apps, among the places, opens your apps
 * the same way (`StripFlyout`). `onToggle` widens the rail for good, and is
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
            label="Expand rail"
            shortcut={HOTKEYS.toggleRail.label}
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
 * The Agents button and its flyout. Rows list executions by name with their
 * status, no chat preview on hover. The badge counts what needs you
 * (approvals and unread, agents included), the same rows the header's pills
 * count.
 */
function AgentsFlyout() {
  const { activeView } = useDashboard();
  const buckets = useSessionBuckets();
  const agents = useAgentAttention();
  const needsYou = agents.length + buckets.needsApproval.length + buckets.unread.length;
  const label = needsYou > 0 ? `Agents: ${needsYou} need${needsYou === 1 ? 's' : ''} you` : 'Agents';
  const inWork = activeView.kind === 'agent' || activeView.kind === 'execution';

  return (
    <StripFlyout
      icon={Bot}
      label={label}
      contentLabel="Agents"
      active={inWork}
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
    >
      <SessionHoverProvider disabled>
        <FlyoutList />
      </SessionHoverProvider>
    </StripFlyout>
  );
}

/** The list header fixed at the top, the list scrolling under it. */
function FlyoutList() {
  const { tab, setTab } = useRailTab();
  return (
    <WorkspaceSelectionProvider>
      <RailListHeader tab={tab} onSelect={setTab} />
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-4">
        <RailListBody tab={tab} />
      </div>
    </WorkspaceSelectionProvider>
  );
}

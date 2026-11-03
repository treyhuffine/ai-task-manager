'use client';

import { Inbox } from 'lucide-react';
import { RailRow, type RailPlace } from '@/components/home/home-navigation';
import { RailFlyout } from './rail-flyout';
import { SessionHoverProvider } from './session-hover-context';
import { SessionHoverPreview } from './session-hover-preview';
import { useWaitingChats, WaitingChatRows } from './needs-review-section';

/**
 * The agents-only rail's Unread (docs/rail-agents-first.md): one row with the
 * count of chats waiting on you, under the pins, instead of a list that
 * crowds the agents. Resting on it peeks the chats beside the rail, and a
 * click holds them, the way Apps and the collapsed rail's Agents do. Each
 * chat keeps its status line (docs/chat-status-lines.md), and resting on one
 * shows its latest messages beside the flyout, as rail rows do. Moving onto
 * that preview holds the flyout.
 *
 * The count is the active chats, the same one rule every list hides by:
 * inactive ones wait behind the flyout's fold. No row when nothing waits.
 */
export function UnreadRow() {
  const { active, inactive, wsName, openSetup } = useWaitingChats({ includeAgents: false });
  if (active.length + inactive.length === 0) return null;
  const place: RailPlace = {
    id: 'unread',
    label: 'Unread',
    title: 'Unread',
    icon: Inbox,
    // The flyout drives the row: a click holds it rather than going anywhere.
    onClick: () => {},
    active: false,
    count: active.length > 0 ? active.length : undefined,
    tone: 'attention',
    flyout: { label: 'Unread', content: null },
  };

  return (
    <div className="border-b border-border/40 px-2 pb-1.5 pt-1">
      <RailFlyout
        contentLabel="Unread"
        trigger={({ ref, open }) => <RailRow ref={ref} place={place} pressed={open} onClick={undefined} />}
      >
        <SessionHoverProvider>
          <div className="flex min-h-8 flex-shrink-0 items-center gap-2 border-b border-border/40 px-3">
            <span className="flex-1 text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Unread</span>
            <span className="text-[9px] font-mono text-muted-foreground/70">{active.length}</span>
          </div>
          <nav aria-label="Unread chats" className="min-h-0 flex-1 overflow-y-auto px-1 py-1.5">
            <WaitingChatRows active={active} inactive={inactive} wsName={wsName} openSetup={openSetup} />
          </nav>
          <SessionHoverPreview />
        </SessionHoverProvider>
      </RailFlyout>
    </div>
  );
}

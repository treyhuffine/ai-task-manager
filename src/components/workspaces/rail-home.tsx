'use client';

import type { ReactNode } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useOrchestratorName } from '@/hooks/use-user-state';
import { useRailSessions } from '@/hooks/use-workspaces';
import { isSessionUnread } from '@/lib/utils/session-sort';
import { OrchestratorAvatar } from '@/components/shared/orchestrator-mark';
import { cn } from '@/lib/utils';
import { useOptionalTeam, useTeamNav } from '@/components/team/team-context';
import { Tip } from '@/components/ui/tip';
import { Users } from 'lucide-react';

/**
 * The top of the rail: the orchestrator, by the name and look the user gave
 * it, and the way home. Home is where the orchestrator lives (its chat on the
 * left, the deck on the right), so it is the home link rather than a separate
 * "Home" item. Highlighted while you're there.
 *
 * `action` sits at the right of the row in the wide rail (the collapse
 * toggle). In the collapsed rail the row folds to the avatar. The name and
 * look are changed in Settings, Profile.
 *
 * The amber dot means it has told you something you haven't read, the same dot
 * an agent's row shows for a new reply. Its chat isn't in Unread, since replies
 * there are the conversation, so this is how a message it sent first shows up.
 */
export function RailHome({ collapsed, action }: { collapsed: boolean; action?: ReactNode }) {
  const { activeView, goHome } = useDashboard();
  const name = useOrchestratorName();
  const team = useOptionalTeam();
  const nav = useTeamNav();
  const home = team ? () => nav.show('chat') : goHome;
  const isHome = activeView.kind === 'home';
  const { data: rail } = useRailSessions();
  const homeChat = team ? null : rail?.homeChat;
  const unread = !isHome && !!homeChat && isSessionUnread(homeChat);
  const homeLabel = `${name}, home${unread ? ', new message' : ''}`;

  if (collapsed) {
    return (
      <div className="flex justify-center pt-2 pb-1">
        <Tip label={`${team ? 'Team: ' : ''}${name} (Home)`}>
          <button
            type="button"
            onClick={home}
            aria-label={homeLabel}
            aria-current={isHome ? 'page' : undefined}
            className={cn(
              'relative rounded-lg p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              isHome ? 'ring-1 ring-primary/40' : 'hover:bg-muted/50',
            )}
          >
            <OrchestratorAvatar size="md" />
            {unread && <span aria-hidden className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-amber-500 ring-2 ring-background" />}
            {team && <span className="absolute -bottom-1 -right-1 rounded bg-primary p-0.5 text-primary-foreground ring-2 ring-background"><Users size={9} aria-hidden /></span>}
          </button>
        </Tip>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 px-2 pt-2 pb-1">
      <button
        type="button"
        onClick={home}
        aria-label={homeLabel}
        aria-current={isHome ? 'page' : undefined}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          isHome ? 'bg-muted/60' : 'hover:bg-muted/40',
        )}
      >
        <OrchestratorAvatar size={team ? 'md' : 'sm'} />
        <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">{name}</span>
        {unread && <span aria-hidden className="ml-auto size-2 shrink-0 rounded-full bg-amber-500" />}
        {team && <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-1.5 py-1 text-[10px] font-semibold text-primary-foreground"><Users size={11} aria-hidden />Team</span>}
      </button>
      {action}
    </div>
  );
}

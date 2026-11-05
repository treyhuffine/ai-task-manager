'use client';
import { CircleCheck, House, Settings } from 'lucide-react';
import { SpaceSelector } from '@/components/spaces/space-selector';
import { useSpace } from '@/components/spaces/space-root';
import { TEAM_ROLE_LABELS } from '@/lib/team/capabilities';
import { RailIconButton } from '@/components/workspaces/rail-icon-button';
import { Tip } from '@/components/ui/tip';
import { cn } from '@/lib/utils';
import { MemberAvatar } from './member-avatar';
import { useTeam, useTeamNav } from './team-context';
export function TeamRailFooter({ collapsed }: { collapsed: boolean }) {
  const { member } = useTeam();
  const nav = useTeamNav();
  const space = useSpace();
  const account = () => nav.openSettings('access');
  return (
    <footer className="flex shrink-0 flex-col gap-1.5 border-t border-border/40 px-2 py-2">
      <SpaceSelector variant={collapsed ? 'collapsed' : 'wide'} onOpenSettings={() => nav.openPanel('settings')} onOpenAccount={account} />
      <div className={cn('flex items-center gap-1.5', collapsed && 'flex-col')}>
        <RailIconButton icon={Settings} label="Settings" onClick={() => nav.openPanel('settings')} />
        <Tip label="Your account">
          <button type="button" aria-label="Your account" onClick={account} className={cn('flex min-w-0 items-center gap-2 rounded-lg text-left text-xs text-muted-foreground hover:bg-muted/40', collapsed ? 'p-1.5' : 'flex-1 border border-border/60 px-2 py-1.5')}>
            <MemberAvatar name={member.name} size="xs" />
            {!collapsed && <><span className="truncate">{member.name}</span><span className="ml-auto text-[10px]">{TEAM_ROLE_LABELS[member.role]}</span></>}
          </button>
        </Tip>
      </div>
      {space && <Tip label={collapsed ? 'Connected to My Ri' : undefined}>
        <span role="status" aria-label="Connected to My Ri" className={cn('flex items-center text-[11px] text-muted-foreground', collapsed ? 'justify-center p-1.5' : 'gap-2 px-2 py-1')}>
          <CircleCheck size={13} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
          {!collapsed && 'Connected to My Ri'}
        </span>
      </Tip>}
      {!space && (collapsed
        ? <RailIconButton icon={House} label="Connect to My Ri" onClick={account} className="self-center" />
        : <button type="button" onClick={account} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-primary hover:bg-muted/40"><House size={13} className="shrink-0" />Connect to My Ri</button>)}
    </footer>
  );
}

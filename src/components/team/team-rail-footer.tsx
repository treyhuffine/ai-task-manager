'use client';
import { Settings } from 'lucide-react';
import { SpaceSelector } from '@/components/spaces/space-selector';
import { RailIconButton } from '@/components/workspaces/rail-icon-button';
import { MemberAvatar } from './member-avatar';
import { useTeam, useTeamNav } from './team-context';
export function TeamRailFooter({ collapsed }: { collapsed: boolean }) {
  const { member } = useTeam();
  const nav = useTeamNav();
  return <footer className="flex shrink-0 flex-col gap-1.5 border-t border-border/40 px-2 py-2">
    <SpaceSelector variant={collapsed ? 'collapsed' : 'wide'} onOpenSettings={() => nav.openPanel('settings')} />
    <div className="flex items-center gap-1.5"><RailIconButton icon={Settings} label="Settings" onClick={() => nav.openPanel('settings')} />
    {!collapsed && <button type="button" onClick={() => nav.openPanel('settings')} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/60 px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/40"><MemberAvatar name={member.name} size="xs" /><span className="truncate">{member.name}</span><span className="ml-auto text-[10px]">{member.role === 'owner' ? 'Owner' : 'Member'}</span></button>}</div>
  </footer>;
}

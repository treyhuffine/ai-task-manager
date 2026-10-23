'use client';
import { useEffect } from 'react';
import { useRailCollapse } from '@/hooks/use-rail-collapse';
import { RailIconButton } from '@/components/workspaces/rail-icon-button';
import { RailContainer } from '@/components/home/home-navigation';
import { RailLayout } from '@/components/home/home-navigation';
import { RailRows } from '@/components/home/home-navigation';
import { useAreas } from '@/hooks/use-areas';
import { cn } from '@/lib/utils';
import { MemberAvatar } from '@/components/team/member-avatar';
import { SpaceSelector } from '@/components/spaces/space-selector';
import { Tip } from '@/components/ui/tip';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';
import { useWorkspaces } from '@/hooks/use-workspaces';
import { useHomeContext } from '@/components/home/home-context';
import { useTeam, useTeamNav, type TeamView } from './team-context';
import { useTeamAiStatus } from './team-chat';
import { PanelLeftClose, PanelLeftOpen, Bot, FileText, KanbanSquare, MessageCircle, Search, Settings } from 'lucide-react';

export function useShowAgents() {
  const { data } = useWorkspaces({ status: 'active' });
  const home = useHomeContext();
  return Boolean(data?.length || (home.capabilities.configureAgents && home.executionChoices.length));
}

function TeamMark({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex flex-shrink-0 items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground',
        size === 'md' ? 'size-6 text-[12px]' : 'size-5 text-[10px]',
      )}
    >
      {name.trim().charAt(0).toUpperCase() || 'T'}
    </span>
  );
}

/** Team AI's chats appear once it's on, and stay readable after it's turned off (§9.9). */
export function useShowChat(): boolean {
  const status = useTeamAiStatus();
  return Boolean(status.data?.enabled || status.data?.mainChatId);
}

export function TeamRail() {
  const { collapsed, toggle } = useRailCollapse();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (matchesHotkey(event, HOTKEYS.toggleRail)) { event.preventDefault(); toggle(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);
  const homeCapabilities = useHomeContext().capabilities;
  const { team, member } = useTeam();
  const nav = useTeamNav();
  const showChat = useShowChat();
  const showAgents = useShowAgents();
  const { data: areas } = useAreas();
  const go = (view: TeamView) => {
    nav.show(view);
  };
  return (
    <div className="hidden md:flex"><RailContainer expanded={!collapsed}><RailLayout header={<>      <div className="px-1 pb-1 pt-2">
        <RailIconButton icon={collapsed ? PanelLeftOpen : PanelLeftClose} label={collapsed ? 'Expand rail' : 'Collapse rail'} shortcut={HOTKEYS.toggleRail.label} onClick={toggle}/>
        <button
          type="button"
          onClick={() => go('board')}
          className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-label={`${team.name}, Tasks`}
        >
          <TeamMark name={team.name} />
          <span className={cn('truncate text-[13px] font-semibold', collapsed && 'hidden')}>{team.name}</span>
        </button>
      </div></>} footer={<>      <div className="flex-shrink-0 border-t border-border/40 px-2 pt-2">
        <SpaceSelector variant={collapsed ? 'collapsed' : 'wide'} onOpenSettings={() => nav.openPanel('settings')} />
      </div>
      <footer className="flex flex-shrink-0 items-center gap-1.5 px-1 py-2">
        <Tip label="Settings">
          <button
            type="button"
            onClick={() => nav.openPanel('settings')}
            aria-label="Settings"
            className="flex size-8 flex-shrink-0 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Settings size={14} />
          </button>
        </Tip>
        <button
          type="button"
          onClick={() => nav.openPanel('settings')}
          className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/60 px-2 py-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:bg-muted/40 hover:text-foreground', collapsed && 'hidden')}
        >
          <MemberAvatar name={member.name} size="xs" />
          <span className="truncate">{member.name}</span>
          {homeCapabilities.administerMembers && <span className="ml-auto text-[10px] text-muted-foreground/70">Owner</span>}
        </button>
      </footer>
</>}>
      <RailRows expanded={!collapsed} label="Places" places={[
        { id: 'tasks', label: 'Tasks', title: 'Tasks', icon: KanbanSquare, active: nav.view === 'board', onClick: () => go('board') },
        { id: 'notes', label: 'Notes', title: 'Notes', icon: FileText, active: nav.view === 'notes', onClick: () => go('notes') },
        ...(showChat ? [{ id: 'chat', label: 'Chat', title: 'Chat', icon: MessageCircle, active: nav.view === 'chat', onClick: () => go('chat') }] : []),
        ...(showAgents ? [{ id: 'agents', label: 'Agents', title: 'Agents', icon: Bot, active: nav.view === 'agents', onClick: () => go('agents') }] : []),
        { id: 'search', label: 'Search', title: 'Search', icon: Search, active: nav.panel === 'search', onClick: () => nav.openPanel('search') },
      ]} />
      {!collapsed && (areas?.length ?? 0) > 0 && (
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-2">
          <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Areas</p>
          <div className="space-y-0.5">
            {areas!.filter((a) => a.status !== 'archived').map((area) => (
              <button
                key={area.id}
                type="button"
                onClick={() => nav.filterArea(nav.areaId === area.id ? null : area.id)}
                aria-pressed={nav.areaId === area.id}
                className={cn(
                  'flex w-full items-center gap-2 truncate rounded-md px-2 py-1 text-left text-[12px] transition-colors',
                  nav.areaId === area.id ? 'bg-muted/60 text-foreground' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                )}
              >
                <span aria-hidden>{area.emoji ?? '·'}</span>
                <span className="truncate">{area.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </RailLayout></RailContainer></div>
  );
}

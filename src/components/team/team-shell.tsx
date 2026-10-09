'use client';

import { useEffect, type ReactNode } from 'react';
import { FileText, KanbanSquare, Plus, Search, Settings } from 'lucide-react';
import { apiErrorStatus } from '@/lib/api/client';
import { useAreas } from '@/hooks/use-areas';
import { useCreateNote } from '@/hooks/use-notes';
import { useCreateTask } from '@/hooks/use-tasks';
import { cn } from '@/lib/utils';
import { Tip } from '@/components/ui/tip';
import { TeamContext, useTeam, useTeamNav, type TeamView } from './team-context';
import { useTeamMe } from './use-team';
import { MemberAvatar } from './member-avatar';
import { TeamBoard } from './team-board';
import { TeamNotes } from './team-notes';
import { TeamDetail } from './team-detail';
import { TeamSettings } from './team-settings';
import { TeamSearch } from './team-search';
import { GateButton, TeamGate } from './team-gate';

/**
 * A team's shell (docs/homes-spec.md §3.2): the team's name as the home row,
 * its Task Board and Notes, its Areas as filters, search and Settings. No
 * main chat, Deck, agents, apps, calendar, schedules or model setup: those
 * are a person's own, and keep running in their own Ri.
 */
export function TeamShell() {
  const me = useTeamMe();
  if (me.isLoading) return null;
  if (!me.data) {
    // A sign-in that stopped working signs this browser out on its own
    // (src/lib/api/client.ts). Anything else is the team being unreachable.
    if (apiErrorStatus(me.error) === 401) return null;
    return (
      <TeamGate title="This team can't be reached">
        <p>The computer hosting it may be asleep or offline. Nothing you wrote is lost.</p>
        <GateButton onClick={() => void me.refetch()}>Retry</GateButton>
      </TeamGate>
    );
  }
  return (
    <TeamContext.Provider value={me.data}>
      <Shell />
    </TeamContext.Provider>
  );
}

function Shell() {
  const { team } = useTeam();
  const nav = useTeamNav();

  useEffect(() => {
    document.title = team.name;
  }, [team.name]);

  // ⌘K searches the team.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        nav.openPanel('search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);

  return (
    <div className="flex h-dvh min-h-0 bg-background text-foreground">
      <TeamRail />
      <main className="flex min-w-0 flex-1 flex-col">
        <PhoneTopBar />
        <div className="min-h-0 flex-1 @container/lt">{nav.view === 'notes' ? <TeamNotes /> : <TeamBoard />}</div>
        <PhoneTabBar />
      </main>
      <TeamDetail />
      <TeamSettings />
      <TeamSearch />
    </div>
  );
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

function RailRow({ icon: Icon, label, active, onClick, trailing }: { icon: typeof KanbanSquare; label: string; active?: boolean; onClick: () => void; trailing?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-md py-1.5 pl-2 pr-2 text-[12px] font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active ? 'bg-muted/60 text-foreground' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
      )}
    >
      <Icon size={14} className="flex-shrink-0" />
      <span className="truncate">{label}</span>
      {trailing}
    </button>
  );
}

function TeamRail() {
  const { team, member } = useTeam();
  const nav = useTeamNav();
  const { data: areas } = useAreas();
  const go = (view: TeamView) => {
    nav.show(view);
  };
  return (
    <aside className="hidden w-[244px] flex-shrink-0 flex-col border-r border-border md:flex" aria-label={team.name}>
      <div className="px-2 pb-1 pt-2">
        <button
          type="button"
          onClick={() => go('board')}
          className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-label={`${team.name}, Task Board`}
        >
          <TeamMark name={team.name} />
          <span className="truncate text-[13px] font-semibold">{team.name}</span>
        </button>
      </div>
      <nav className="space-y-0.5 px-2 pt-1">
        <RailRow icon={KanbanSquare} label="Task Board" active={nav.view === 'board'} onClick={() => go('board')} />
        <RailRow icon={FileText} label="Notes" active={nav.view === 'notes'} onClick={() => go('notes')} />
        <RailRow
          icon={Search}
          label="Search"
          onClick={() => nav.openPanel('search')}
          trailing={<kbd className="ml-auto rounded border border-border/60 px-1 text-[9px] text-muted-foreground">⌘K</kbd>}
        />
      </nav>
      {(areas?.length ?? 0) > 0 && (
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
      <div className="flex-1" />
      <footer className="flex flex-shrink-0 items-center gap-1.5 border-t border-border/40 px-2 py-2">
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
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/60 px-2 py-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:bg-muted/40 hover:text-foreground"
        >
          <MemberAvatar name={member.name} size="xs" />
          <span className="truncate">{member.name}</span>
          {member.role === 'owner' && <span className="ml-auto text-[10px] text-muted-foreground/70">Owner</span>}
        </button>
      </footer>
    </aside>
  );
}

function PhoneTopBar() {
  const { team } = useTeam();
  const nav = useTeamNav();
  return (
    <header className="flex items-center gap-2 border-b border-border px-3 py-2 md:hidden">
      <TeamMark name={team.name} size="sm" />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{team.name}</span>
      <button type="button" onClick={() => nav.openPanel('search')} aria-label="Search" className="rounded-md p-2 text-muted-foreground hover:bg-muted/50">
        <Search size={16} />
      </button>
    </header>
  );
}

function PhoneTabBar() {
  const nav = useTeamNav();
  const createTask = useCreateTask();
  const createNote = useCreateNote();
  const add = async () => {
    if (nav.view === 'notes') {
      const note = await createNote.mutateAsync({ body: '', ...(nav.areaId ? { areaId: nav.areaId } : {}) });
      nav.openNote(note.id);
    } else {
      const task = await createTask.mutateAsync({ title: 'New task', rawInput: 'New task', ...(nav.areaId ? { areaId: nav.areaId } : {}) });
      nav.openTask(task.id);
    }
  };
  const tab = (active: boolean) =>
    cn('flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium', active ? 'text-foreground' : 'text-muted-foreground');
  return (
    <nav className="flex items-stretch border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Team">
      <button type="button" className={tab(nav.view === 'board')} onClick={() => nav.show('board')}>
        <KanbanSquare size={18} />
        Tasks
      </button>
      <button type="button" className={tab(nav.view === 'notes')} onClick={() => nav.show('notes')}>
        <FileText size={18} />
        Notes
      </button>
      <button type="button" className={tab(false)} onClick={() => void add()} aria-label={nav.view === 'notes' ? 'New note' : 'New task'}>
        <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Plus size={16} />
        </span>
      </button>
      <button type="button" className={tab(nav.panel === 'settings')} onClick={() => nav.openPanel('settings')}>
        <Settings size={18} />
        Settings
      </button>
    </nav>
  );
}

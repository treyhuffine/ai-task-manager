'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, House, Plus, Settings, UserPlus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tip } from '@/components/ui/tip';
import { currentSpaceId, spacePath } from '@/lib/spaces/document';
import { myRiClient } from '@/lib/spaces/my-ri-client';
import { teamDisplayName } from '@/lib/home/team-display-name';
import { cn } from '@/lib/utils';
import { teamConnectionsKey } from '@/lib/spaces/client-cache';
import { useOptionalHomeContext } from '@/components/home/home-context';
import { restoredHomeNavigation } from '@/lib/home/navigation';

/**
 * The compact space selector (docs/homes-spec.md §3.2, P7.1): My Ri and the
 * teams this Ri is connected to, plus Join a team and Create a team. It shows
 * only once a team is connected. Choosing a space opens it as its own page,
 * back where it was last left on this screen, and changes nothing else:
 * running work keeps its owner and terminal, and other screens keep their
 * place.
 */

const navKey = (space: string | null) => `ri:space-nav:${space ?? 'my-ri'}`;

export function useConnectedTeams(enabled = true) {
  return useQuery({
    enabled,
    queryKey: teamConnectionsKey(),
    queryFn: () => myRiClient.spaces.list.query(),
    staleTime: 60_000,
  });
}

function openSpace(target: string | null) {
  const here = currentSpaceId();
  if (target === here) return;
  let url = target ? spacePath(target) : '/';
  try {
    sessionStorage.setItem(navKey(here), window.location.pathname + window.location.search);
    const saved = sessionStorage.getItem(navKey(target));
    url = restoredHomeNavigation(target, saved) ?? url;
  } catch {
    // Without session storage a space opens at its start.
  }
  window.location.assign(url);
}

function openTeamsSettings() {
  if (currentSpaceId()) {
    window.location.assign('/?settings=teams');
    return;
  }
  void import('@/components/settings/settings-store').then(({ openSettings }) => openSettings('teams'));
}

function createTeam() {
  const connection = window.riDesktop?.connection;
  if (connection) void connection('create-team');
  else openTeamsSettings();
}

function Mark({ name, size = 18 }: { name: string | null; size?: number }) {
  if (!name) {
    return (
      <span aria-hidden className="inline-flex flex-shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground" style={{ width: size, height: size }}>
        <House size={Math.round(size * 0.62)} />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="inline-flex flex-shrink-0 items-center justify-center rounded-md bg-primary text-[10px] font-semibold text-primary-foreground"
      style={{ width: size, height: size }}
    >
      {name.trim().charAt(0).toUpperCase() || 'T'}
    </span>
  );
}

export function SpaceSelector({ variant, onOpenSettings }: { variant: 'wide' | 'collapsed' | 'phone'; onOpenSettings?: () => void }) {
  const home = useOptionalHomeContext();
  const here = currentSpaceId();
  const standalone = home?.home.kind === 'team' && !here ? home.home : null;
  const connected = useConnectedTeams(!standalone);
  const teams = standalone ? [] : (connected.data ?? []).filter((t) => t.status === 'active');
  if (!standalone && !here && teams.length === 0) return null;
  const currentName = standalone?.name ?? (here ? teamDisplayName(here, connected.data) : null);
  const label = currentName ?? 'My Ri';

  const trigger =
    variant === 'collapsed' ? (
      <Tip label={`Space: ${label}`}>
        <button
          type="button"
          aria-label={`Space: ${label}. Switch space`}
          className="rounded-md p-1 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Mark name={currentName} />
        </button>
      </Tip>
    ) : (
      <button
        type="button"
        aria-label={`Space: ${label}. Switch space`}
        className={cn(
          'flex min-w-0 items-center gap-2 rounded-lg text-[12px] font-medium text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          variant === 'wide' ? 'w-full border border-border/60 px-2 py-1.5' : 'max-w-[11rem] px-1.5 py-1',
        )}
      >
        <Mark name={currentName} />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <ChevronsUpDown size={12} className="flex-shrink-0 text-muted-foreground" />
      </button>
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={variant === 'phone' ? 'bottom' : 'top'} className="w-56">
        {standalone ? <DropdownMenuItem className="gap-2 text-[13px]">
          <Mark name={standalone.name} />
          <span className="min-w-0 flex-1 truncate">{standalone.name}</span>
          <Check size={14} />
        </DropdownMenuItem> : <DropdownMenuItem onSelect={() => openSpace(null)} className="gap-2 text-[13px]">
          <Mark name={null} />
          <span className="flex-1">My Ri</span>
          {!here && <Check size={14} />}
        </DropdownMenuItem>}
        {teams.map((team) => (
          <DropdownMenuItem key={team.id} onSelect={() => openSpace(team.id)} className="gap-2 text-[13px]">
            <Mark name={teamDisplayName(team.id, connected.data)} />
            <span className="min-w-0 flex-1 truncate">{teamDisplayName(team.id, connected.data)}</span>
            {here === team.id && <Check size={14} />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {standalone ? <DropdownMenuItem onSelect={onOpenSettings} className="gap-2 text-[13px]">
          <Settings size={14} className="text-muted-foreground" /> Home settings
        </DropdownMenuItem> : <><DropdownMenuItem onSelect={openTeamsSettings} className="gap-2 text-[13px]">
          <UserPlus size={14} className="text-muted-foreground" /> Join a team
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={createTeam} className="gap-2 text-[13px]">
          <Plus size={14} className="text-muted-foreground" /> Create a team
        </DropdownMenuItem></>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

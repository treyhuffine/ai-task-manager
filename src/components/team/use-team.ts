'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc/client';

/** The team and who's signed in. Enabled only once this browser holds a key. */
export function useTeamMe(enabled = true) {
  return useQuery({ ...trpc.team.me.queryOptions(), enabled, staleTime: 30_000, retry: false });
}

/** Everyone in the team, removed members included so history keeps their names. */
export function useTeamMembers() {
  const query = useQuery({ ...trpc.team.members.queryOptions(), staleTime: 30_000 });
  const byId = useMemo(() => new Map((query.data ?? []).map((m) => [m.id, m])), [query.data]);
  const active = useMemo(() => (query.data ?? []).filter((m) => m.active), [query.data]);
  return { ...query, byId, active };
}

/** Two letters for a member's avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

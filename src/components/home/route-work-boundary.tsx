'use client';
import { useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { WorkContext } from '@/contexts/work-context';
import { useHomeContext } from './home-context';
import { useSpace } from '@/components/spaces/space-root';
import { homeResourceHref } from '@/lib/home/resource-href';

/** Standalone resource pages use the same navigation contract as the Home shell. */
export function RouteWorkBoundary({ children }: { children: ReactNode }) {
  const router = useRouter();
  const home = useHomeContext();
  const space = useSpace();
  const [activeExecutionId, setActiveExecutionId] = useState<string | null>(null);
  const [streamingSessionIds, setStreaming] = useState<ReadonlySet<string>>(() => new Set());
  const navigation = useMemo(() => {
    const open = (kind: Parameters<typeof homeResourceHref>[0], id: string) => router.push(homeResourceHref(kind, id, { kind: home.home.kind, spaceId: space?.id }));
    return { openTask: (id: string) => open('task', id), openNote: (id: string) => open('note', id), openExecution: (id: string) => open('session', id), openAgent: (id: string) => open('agent', id), goHome: () => router.push(space ? `/space/${encodeURIComponent(space.id)}` : '/') };
  }, [router, home.home.kind, space]);
  return <WorkContext navigation={navigation} activity={{ activeSessionId: null, activeExecutionId, setActiveExecutionId, streamingSessionIds, backgroundSessionIds: new Set(), pendingInputSessionIds: new Set(), setSessionStreaming: (id, running) => setStreaming(previous => { const next = new Set(previous); if (running) next.add(id); else next.delete(id); return next; }) }}>{children}</WorkContext>;
}

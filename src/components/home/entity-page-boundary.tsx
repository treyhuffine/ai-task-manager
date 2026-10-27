'use client';
import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useHomeContext } from './home-context';
import { useSpace } from '@/components/spaces/space-root';
import { homeResourceHref } from '@/lib/home/resource-href';
import { RouteWorkBoundary } from './route-work-boundary';

/** Legacy standalone entity URLs resolve through their owning Home's shared surface. */
export function EntityPageBoundary({ kind, id, children }: { kind: 'task' | 'note'; id: string; children: ReactNode }) {
  const home = useHomeContext();
  const space = useSpace();
  const router = useRouter();
  const destination = home.home.kind === 'team' ? homeResourceHref(kind, id, { kind: 'team', spaceId: space?.id }) : null;
  useEffect(() => { if (destination) router.replace(destination); }, [destination, router]);
  return destination ? <a href={destination} className="p-6 text-sm">Opening {kind} in {home.home.name}…</a> : <RouteWorkBoundary>{children}</RouteWorkBoundary>;
}

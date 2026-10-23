import { LifecycleGuardProvider } from '@/components/tasks/lifecycle-guard';
import type { ReactNode } from 'react';
import { RouteWorkBoundary } from '@/components/home/route-work-boundary';
import { HomeBoundary } from '@/components/home/home-context';

export default function ResultsLayout({ children }: { children: ReactNode }) {
  return <HomeBoundary><RouteWorkBoundary><LifecycleGuardProvider>{children}</LifecycleGuardProvider></RouteWorkBoundary></HomeBoundary>;
}

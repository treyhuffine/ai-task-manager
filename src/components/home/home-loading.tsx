import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { HomeShell } from './home-shell';

/** Anonymous chrome only. No member data, drafts or interactive editors mount. */
export function HomeLoading({ children }: { children?: ReactNode }) {
  return <div role="status" aria-label="Loading Ri" aria-busy="true">
    <HomeShell navigation={<aside aria-hidden className="hidden w-[256px] shrink-0 flex-col gap-5 border-r border-border p-4 md:flex">
      <Skeleton className="h-7 w-32 motion-reduce:animate-none" />
      {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-5 w-full motion-reduce:animate-none" />)}
      <div className="flex-1" /><Skeleton className="h-8 w-full motion-reduce:animate-none" />
    </aside>}>
      <div aria-hidden className="flex flex-col gap-5 p-5 md:p-8">
        <Skeleton className="h-7 w-36 motion-reduce:animate-none" />
        <div className="flex gap-3"><Skeleton className="h-7 w-20 motion-reduce:animate-none" /><Skeleton className="h-7 w-24 motion-reduce:animate-none" /></div>
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12 w-full motion-reduce:animate-none" />)}
      </div>
      {children}
    </HomeShell>
  </div>;
}

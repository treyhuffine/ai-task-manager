import { Skeleton } from '@/components/ui/skeleton';
import s from './review.module.css';

export function LibraryRowsSkeleton({ label }: { label: string }) {
  return <div role="status" aria-label={`Loading ${label.toLowerCase()}`}>
    {[0, 1].map(index => <div key={index} className={s.libraryEntry} aria-hidden="true">
      <Skeleton className="size-6 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-3 w-3/4" /><Skeleton className="h-2.5 w-1/2" /></div>
      <Skeleton className="size-3 shrink-0" />
    </div>)}
  </div>;
}

export function CatalogSkeleton() {
  return <div className={s.grid} role="status" aria-label="Loading catalog">
    {Array.from({ length: 8 }, (_, index) => <div key={index} className={s.card} aria-hidden="true">
      <div className={s.cardTop}><Skeleton className="size-9 shrink-0 rounded-lg" /><div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-3 w-3/4" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /></div></div>
      <div className={s.itemType}><Skeleton className="h-2.5 w-24" /></div>
      <div className={s.cardFoot}><Skeleton className="h-2.5 w-16" /><Skeleton className="h-6 w-20 rounded-full" /></div>
    </div>)}
  </div>;
}

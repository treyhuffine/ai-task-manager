'use client';

import { BriefcaseBusiness, House, PencilRuler, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { COLLECTIONS, collectionItems, type ReviewItem } from './catalog';
import { useReview } from './context';
import { ItemCard, ItemMark } from './items';
import s from './review.module.css';

export function SectionTitle({ children, count, action }: { children: React.ReactNode; count?: number; action?: React.ReactNode }) {
  return <div className={s.sectionTitle}><h2>{children}{count !== undefined && <span>{count}</span>}</h2>{action}</div>;
}
export function SearchBox({ placeholder = 'Search a name or something you want to do' }: { placeholder?: string }) {
  const review = useReview();
  return <form role="search" className={s.search} onSubmit={event => { event.preventDefault(); review.commitSearch(); }}><Search size={15} />
    <Input type="search" aria-label="Search additions" value={review.search} onChange={event => review.setSearch(event.target.value)} onBlur={review.commitSearch} placeholder={placeholder} />
    {review.search && <Button className={s.searchClear} type="button" variant="ghost" size="icon-xs" aria-label="Clear search" onClick={review.clearSearch}><X size={12} /></Button>}
  </form>;
}
export function Empty({ children = 'No matches. Try another name or a different filter.' }: { children?: React.ReactNode }) { return <div className={s.empty}>{children}</div>; }
export function Cards({ items }: { items: ReviewItem[] }) {
  if (!items.length) return <Empty />;
  return <div className={s.grid}>{items.map(item => <ItemCard key={item.key} item={item} />)}</div>;
}
export function CollectionTiles() {
  const review = useReview();
  const icons = { business: BriefcaseBusiness, life: House, ideas: PencilRuler };
  return <div className={s.collectionGrid}>{COLLECTIONS.map(collection => {
    const Icon = icons[collection.id];
    return <button type="button" className={s.collectionTile} key={collection.id} aria-pressed={review.query.collection === collection.id} onClick={() => review.patch({ collection: collection.id, item: undefined })}>
      <Icon size={21} /><h3>{collection.name}</h3><p>{collection.description}</p><div className={s.collectionMarks}>{review.loading ? [0, 1, 2].map(index => <Skeleton key={index} className="size-6 rounded-md" aria-hidden="true" />) : collectionItems(review.items, collection.id).slice(0, 4).map(item => <ItemMark key={item.key} item={item} small />)}</div>
    </button>;
  })}</div>;
}

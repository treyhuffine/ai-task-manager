'use client';
import { Button } from '@/components/ui/button';
import { useReview } from '../context';
import { WithInspector } from '../details';
import { COLLECTIONS, collectionItems } from '../catalog';
import { ItemRow } from '../items';
import { Header, SearchBox, CollectionTiles, SectionTitle, Cards, LibraryButton } from '../shared';
import s from '../review.module.css';
export function GoalBundles() {
  const review = useReview();
  const collection = review.collection ?? COLLECTIONS[0];
  const items = collectionItems(review.items, collection.id);
  const next = items.find(item => !item.added || item.draft);
  const all = review.query.all === '1';
  return <><Header subtitle="Start with what you want to do." /><WithInspector><div className={s.body}><div className={s.page}><SearchBox />{review.search || all ? <><Button variant="ghost" size="xs" className="mb-4" onClick={() => { review.setSearch(''); review.patch({ all: undefined, q: undefined }); }}>Back to collections</Button><Cards items={review.matching(review.discovered)} /></> : <>
    <section className={s.section}><SectionTitle>What would make your day easier?</SectionTitle><CollectionTiles /></section>
    <section className={s.bundleBody}><SectionTitle action={<span className={s.muted}>{items.filter(item => item.added && !item.draft).length} of {items.length} added</span>}>{collection.name}</SectionTitle><p className={s.muted}>{collection.description}</p>{items.map(item => <ItemRow key={item.key} item={item} />)}<div className="mt-5"><Button size="sm" disabled={review.busy} onClick={() => next ? review.primary(next) : review.showLibrary()}>{next ? `Set up ${next.name}` : 'Open your library'}</Button><p className={`${s.muted} mt-2`}>Set up each addition with its own account or installation choices.</p></div></section>
    <div className="mt-5 flex justify-between gap-2"><Button variant="ghost" size="xs" onClick={() => review.patch({ all: '1' })}>Browse everything</Button><LibraryButton /></div>
  </>}</div></div></WithInspector></>;
}

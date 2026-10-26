'use client';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { useElementWidth } from '@/hooks/use-element-width';
import { useReview } from '../context';
import { useReviewRailTarget } from '../rail-portal';
import { WithInspector } from '../details';
import { Header, SectionTitle, OwnedList, Discovery, LibraryButton, AddYourOwn } from '../shared';
import s from '../review.module.css';
export function AppsRail() {
  const review = useReview();
  const target = useReviewRailTarget();
  const [measure, width] = useElementWidth<HTMLDivElement>();
  const rail = <div className={s.railLibrary}><Button className="mb-4 w-full justify-start" variant="secondary" size="xs" onClick={review.showDiscover}>Discover</Button><SectionTitle count={review.library.length}>Your library</SectionTitle><OwnedList /><div className="mt-4 space-y-3"><LibraryButton /><AddYourOwn /></div></div>;
  return <div ref={measure} className={s.railFrame}>{target ? (width !== null && width > 0 ? createPortal(rail, target) : null) : <aside className={s.fallbackRail}>{rail}</aside>}<div className={s.frame}><Header title="Discover" subtitle="Find your next useful addition." /><WithInspector><div className={s.body}><div className={s.page}><Discovery heading="Make more possible" /></div></div></WithInspector></div></div>;
}

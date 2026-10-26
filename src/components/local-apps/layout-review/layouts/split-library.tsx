'use client';
import { useReview } from '../context';
import { ItemDetails } from '../details';
import { Header, SectionTitle, OwnedList, Discovery, AddYourOwn } from '../shared';
import s from '../review.module.css';
export function SplitLibrary() {
  const review = useReview();
  return <><Header subtitle="Your library and the next thing you can do." /><div className={s.columns}><section className={s.owned}><SectionTitle count={review.library.length}>Your library</SectionTitle><p className={s.muted}>Ready when you need it.</p><OwnedList /><div className="mt-5"><AddYourOwn /></div></section><section className={s.catalogPane}>{review.selected ? <ItemDetails item={review.selected} /> : <Discovery initial={8} />}</section></div></>;
}

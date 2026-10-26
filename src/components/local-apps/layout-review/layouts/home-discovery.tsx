'use client';
import { useReview } from '../context';
import { ItemDetails } from '../details';
import { LiveChat, Today } from '../live-surfaces';
import { Header, QuickAccess, Discovery } from '../shared';
import s from '../review.module.css';
export function HomeDiscovery() {
  const review = useReview();
  return <><Header title="Your day" subtitle="Your work, with more possibilities close by." /><div className={s.chatColumns}><LiveChat /><section className={s.homeColumn}><Today /><div className={s.catalogPane}><QuickAccess /><section className={s.section}>{review.selected ? <ItemDetails item={review.selected} /> : <Discovery initial={4} />}</section></div></section></div></>;
}

'use client';
import { useReview } from '../context';
import { ItemDetails } from '../details';
import { LiveChat } from '../live-surfaces';
import { Header, Discovery, SectionTitle, OwnedList } from '../shared';
import s from '../review.module.css';
export function BesideChat() {
  const review = useReview();
  return <><Header title="Chat and explore" subtitle="Find something useful without leaving the conversation." /><div className={s.chatColumns}><LiveChat /><aside className={s.catalogPane}>{review.selected ? <ItemDetails item={review.selected} /> : <><Discovery heading="More ways to move forward" initial={6} /><section className={s.section}><SectionTitle>Already available</SectionTitle><OwnedList limit={3} /></section></>}</aside></div></>;
}

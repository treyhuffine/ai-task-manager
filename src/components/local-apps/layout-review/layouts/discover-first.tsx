'use client';
import { Header, QuickAccess, Discovery } from '../shared';
import { WithInspector } from '../details';
import s from '../review.module.css';
export function DiscoverFirst() {
  return <><Header /><WithInspector><div className={s.body}><div className={s.page}><QuickAccess /><section className={s.section}><Discovery featured /></section></div></div></WithInspector></>;
}

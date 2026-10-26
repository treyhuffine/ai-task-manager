'use client';
import { Fragment } from 'react';
import { useReview } from '../context';
import { ItemDetails } from '../details';
import { ItemRow } from '../items';
import { Header, SearchBox, Filters, Empty } from '../shared';
import s from '../review.module.css';
const GROUPS = [{ purpose: 'Work', name: 'Stay connected', hint: 'People, conversations, and work.' }, { purpose: 'Life', name: 'Make room for life', hint: 'Money, time, and plans.' }, { purpose: 'Create', name: 'Think and create', hint: 'From information to something useful.' }];
export function OneCollection() {
  const review = useReview();
  const items = review.matching(review.items);
  return <><Header subtitle="Everything Ri can do, together." /><div className={s.body}><div className={s.page}><SearchBox /><Filters availability />{GROUPS.map(group => {
    const matches = items.filter(item => item.purpose === group.purpose);
    return !!matches.length && <section className={s.purpose} key={group.purpose}><div><h2>{group.name}</h2><p>{group.hint}</p></div><div>{matches.map(item => <Fragment key={item.key}><ItemRow item={item} />{review.selected?.key === item.key && <ItemDetails item={item} />}</Fragment>)}</div></section>;
  })}{!items.length && <Empty />}</div></div></>;
}

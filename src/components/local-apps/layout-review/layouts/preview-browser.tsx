'use client';
import { useReview } from '../context';
import { ItemDetails } from '../details';
import { ItemMark } from '../items';
import { LiveApp } from '../live-surfaces';
import { Header, SearchBox, Filters, Empty } from '../shared';
import s from '../review.module.css';
export function PreviewBrowser() {
  const review = useReview();
  const items = review.matching(review.items);
  const selected = review.selected ?? items.find(item => item.catalog) ?? items[0];
  return <><Header subtitle="Browse something. See what it can do." /><div className={s.browser}><nav className={s.browserList} aria-label="Browse additions"><SearchBox placeholder="Search the catalog" /><Filters availability />{items.map(item => <button type="button" key={item.key} className={s.browserItem} aria-pressed={selected?.key === item.key} onClick={() => review.patch({ item: item.key, panel: undefined, app: undefined })}><ItemMark item={item} small /><span><strong>{item.name}</strong><small>{item.status}</small></span></button>)}{!items.length && <Empty />}</nav>
    {review.selectedApp ? <LiveApp key={review.selectedApp.key} item={review.selectedApp} /> : <div className={s.body}>{selected ? <ItemDetails item={selected} closable={false} /> : <Empty>Choose an addition to explore it here.</Empty>}</div>}
  </div></>;
}

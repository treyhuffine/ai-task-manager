'use client';
import { useReview } from '../context';
import { ItemDetails } from '../details';
import { LiveApp } from '../live-surfaces';
import { Header, Discovery, Empty } from '../shared';
import s from '../review.module.css';
export function DiscoveryShelf() {
  const review = useReview();
  const apps = review.library.filter(item => item.view && item.usable !== false && item.enabled !== false);
  const current = review.selectedApp ?? apps.find(item => /financ/i.test(item.name)) ?? apps[0];
  return <><Header subtitle="Keep working, with something new within reach.">{!!apps.length && <select className={s.typeFilter} aria-label="App above discovery" value={current?.key ?? ''} onChange={event => review.patch({ app: event.target.value, item: undefined })}>{apps.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}</select>}</Header><div className={s.body}>
    <div className={s.shelfApp}>{current ? <LiveApp key={current.key} item={current} /> : <div className="m-auto max-w-lg p-6"><Empty>Open your first app here. Discover apps below, then preview and install one to get started.</Empty></div>}</div>
    <section className={s.shelfCatalog}>{review.selected ? <ItemDetails item={review.selected} /> : <Discovery heading="Discover more for your Ri" initial={6} />}</section>
  </div></>;
}

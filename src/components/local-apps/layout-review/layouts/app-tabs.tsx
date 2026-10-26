'use client';
import { useState } from 'react';
import { Compass, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useReview } from '../context';
import { WithInspector } from '../details';
import { ItemMark } from '../items';
import { LiveApp } from '../live-surfaces';
import { Header, Discovery, QuickAccess, LibraryButton } from '../shared';
import s from '../review.module.css';
export function AppTabs() {
  const review = useReview();
  const [closed, setClosed] = useState<string[]>([]);
  const openable = review.library.filter(item => item.view && item.usable !== false && item.enabled !== false);
  const keys = [...new Set([...(review.selectedApp ? [review.selectedApp.key] : []), ...review.preferences.recent, ...openable.slice(0, 2).map(item => item.key)])];
  const tabs = keys.flatMap(key => { const item = openable.find(item => item.key === key); return item && (!closed.includes(key) || review.selectedApp?.key === key) ? [item] : []; });
  return <><nav className={s.dock} aria-label="Open apps"><div className={s.dockScroll}><div className={s.dockTab} aria-current={!review.selectedApp ? 'page' : undefined}><button type="button" onClick={review.showDiscover}><Compass size={13} />Discover</button></div>
    {tabs.map(item => <div key={item.key} className={s.dockTab} aria-current={review.selectedApp?.key === item.key ? 'page' : undefined}><button type="button" onClick={() => review.open(item)}><ItemMark item={item} small />{item.name}</button><Button size="icon-xs" variant="ghost" aria-label={`Close ${item.name} tab`} onClick={() => { setClosed(previous => [...previous, item.key]); if (review.selectedApp?.key === item.key) review.showDiscover(); }}><X size={11} /></Button></div>)}
  </div><LibraryButton /></nav>{review.selectedApp ? <LiveApp key={review.selectedApp.key} item={review.selectedApp} /> : <><Header title="Discover" subtitle="Find something useful, then open it alongside your work." /><WithInspector><div className={s.body}><div className={s.page}><Discovery /><section className={s.section}><QuickAccess /></section></div></div></WithInspector></>}</>;
}

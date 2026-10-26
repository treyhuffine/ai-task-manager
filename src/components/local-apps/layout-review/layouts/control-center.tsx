'use client';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useReview } from '../context';
import { ItemDetails } from '../details';
import { ItemMark, ManageButton } from '../items';
import { itemType } from '../catalog';
import { Header, Discovery, SectionTitle, Empty, AddYourOwn } from '../shared';
import s from '../review.module.css';
export function ControlCenter() {
  const review = useReview();
  return <><Header subtitle="See what Ri can use. Add what’s missing." /><div className={`${s.columns} ${s.controlColumns}`}><section className={s.owned}><SectionTitle count={review.library.length}>Available to Ri</SectionTitle>
    {review.library.map(item => <div className={s.ownedRow} key={item.key} data-item={item.key}><button type="button" className={s.ownedButton} onClick={() => review.primary(item)}><ItemMark item={item} small /><span><strong>{item.name}</strong><small>{itemType(item)} · {item.enabled === false ? 'Off' : item.status}</small></span></button>
      {item.enabled !== undefined ? <Switch checked={item.enabled} disabled={review.busy} onCheckedChange={() => review.toggle(item)} aria-label={`Allow Ri to use ${item.name}`} /> : <Button variant="ghost" size="xs" onClick={() => review.manage(item)}>{item.kind === 'skills' ? 'Edit' : 'Access'}</Button>}<ManageButton item={item} /></div>)}
    {!review.library.length && <Empty>Your additions will appear here.</Empty>}<p className={`${s.muted} mt-5`}>Turn apps and custom MCPs off without losing their setup. Manage account access and skill installation in their settings.</p><div className="mt-5"><AddYourOwn /></div>
  </section><section className={s.catalogPane}>{review.selected ? <ItemDetails item={review.selected} /> : <Discovery initial={8} />}</section></div></>;
}

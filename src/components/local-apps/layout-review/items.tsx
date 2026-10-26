'use client';

import { BookOpen, Check, CirclePause, LayoutGrid, MessageCircle, Server, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IntegrationLogo } from '@/components/integrations/integration-logo';
import { Tip } from '@/components/ui/tip';
import { AppMark } from '../app-mark';
import { itemType, primaryLabel, type ReviewItem } from './catalog';
import { useReview } from './context';
import s from './review.module.css';

export function ItemMark({ item, small = false }: { item: ReviewItem; small?: boolean }) {
  if (item.providerId) return <IntegrationLogo providerId={item.providerId} name={item.name} size={small ? 24 : 36} />;
  if (item.kind === 'skills' || item.target.kind === 'mcp') {
    const Icon = item.kind === 'skills' ? BookOpen : Server;
    return <span aria-hidden className={`${s.mark} ${small ? s.markSmall : ''} ${item.kind === 'skills' ? s.skillMark : ''}`}><Icon size={small ? 13 : 18} /></span>;
  }
  return <AppMark name={item.name} icon={item.icon} size={small ? 'sm' : 'lg'} />;
}
export function ItemStatus({ item }: { item: ReviewItem }) {
  return <span className={`${s.status} ${item.attention ? s.attention : ''}`}>
    {item.added && !item.draft && !item.attention && (item.enabled === false ? <CirclePause size={11} /> : <Check size={11} />)}<span>{item.status}</span>
  </span>;
}
export function PrimaryButton({ item }: { item: ReviewItem }) {
  const review = useReview();
  return <Button size="xs" variant={item.added ? 'outline' : 'default'} disabled={review.busy} onClick={() => review.primary(item)} aria-label={`${primaryLabel(item)} ${item.name}`}>{primaryLabel(item)}</Button>;
}
export function ManageButton({ item }: { item: ReviewItem }) {
  const review = useReview();
  return <Button size="icon-xs" variant="ghost" onClick={() => review.details(item, true)} aria-label={`Manage ${item.name}`}><Settings2 size={13} /></Button>;
}
export function ItemCard({ item }: { item: ReviewItem }) {
  const review = useReview();
  return <article className={s.card} data-item={item.key}>
    <button className={s.cardTop} type="button" onClick={() => review.details(item)} aria-label={`Details for ${item.name}`}>
      <ItemMark item={item} /><span className={s.cardCopy}><h3>{item.name}</h3><span className={s.description}>{item.description}</span></span>
    </button>
    <div className={s.itemType}>{item.view ? <LayoutGrid size={11} /> : item.kind === 'skills' ? <BookOpen size={11} /> : <MessageCircle size={11} />}{itemType(item)}{item.view && ' · Opens in Ri'}</div>
    <div className={s.cardFoot}><ItemStatus item={item} /><div className={s.actions}><PrimaryButton item={item} />{item.added && <ManageButton item={item} />}</div></div>
  </article>;
}
export function ItemRow({ item, children }: { item: ReviewItem; children?: React.ReactNode }) {
  const review = useReview();
  return <div className={s.flat} data-item={item.key}>
    <button className={s.flatMain} type="button" onClick={() => review.details(item)} aria-label={`Details for ${item.name}`}><ItemMark item={item} /><span><h3>{item.name}</h3><p>{item.description}</p></span></button>
    <div className={s.actions}>{children ?? <><PrimaryButton item={item} />{item.added && <ManageButton item={item} />}</>}</div>
  </div>;
}
export function OwnedRow({ item }: { item: ReviewItem }) {
  const review = useReview();
  return <div className={s.ownedRow} data-item={item.key}><Tip label={item.name} onlyWhenTextHidden><button className={s.ownedButton} type="button" onClick={() => review.primary(item)} aria-label={`${primaryLabel(item)} ${item.name}`}>
    <ItemMark item={item} small /><span><strong>{item.name}</strong><small>{item.enabled === false ? 'Turned off' : itemType(item)}</small></span>
  </button></Tip><ManageButton item={item} /></div>;
}

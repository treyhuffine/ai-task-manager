'use client';

import { useEffect, useRef } from 'react';
import { BookOpen, LayoutGrid, MessageCircle, Pin, Settings2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useSkill } from '@/hooks/use-skills';
import { itemType, type ReviewItem } from './catalog';
import { useReview } from './context';
import { ItemMark, ItemStatus, PrimaryButton } from './items';
import { CatalogDemo } from './shared';
import s from './review.module.css';

/** Details stay beside the catalog. Management delegates to Ri's real editors. */
export function ItemDetails({ item, closable = true }: { item: ReviewItem; closable?: boolean }) {
  const review = useReview();
  const settings = review.query.panel === 'settings';
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (review.query.item !== item.key || !heading.current?.getClientRects().length) return;
    heading.current.focus({ preventScroll: true });
    const root = heading.current.closest('[data-apps-layout]');
    if (root && root.clientWidth <= 760) heading.current.scrollIntoView({ block: 'start' });
  }, [item.key, review.query.item]);
  return <section className={s.details} aria-label={`${item.name} details`}>
    <div className={s.detailHead}><ItemMark item={item} /><div className="min-w-0 flex-1"><h2 ref={heading} tabIndex={-1} className="outline-none">{item.name}</h2><p className={s.muted}>{itemType(item)} · {item.status}</p></div>
      {closable && <Button variant="ghost" size="icon-xs" aria-label="Close details" onClick={() => review.patch({ item: undefined, panel: undefined, app: undefined })}><X size={15} /></Button>}
    </div>
    <p className={s.detailCopy}>{item.description}</p>
    <div className={s.actions}><PrimaryButton item={item} />{item.added && item.view && item.chat && item.usable !== false && !item.attention && <Button size="xs" variant="outline" onClick={() => review.chat(item)}><MessageCircle size={12} />Try in chat</Button>}</div>
    <div className={s.detailTabs} aria-label="Addition details"><button type="button" aria-pressed={!settings} onClick={() => review.details(item)}>Overview</button>{item.added && <button type="button" aria-pressed={settings} onClick={() => review.details(item, true)}>Settings</button>}</div>
    {settings && item.added ? <>
      {(item.target.kind === 'app' || item.target.kind === 'mcp') && item.enabled !== undefined && <div className={s.setting}><span>Available to Ri<small>Turning this off keeps its setup.</small></span><Switch checked={item.enabled} disabled={review.busy} onCheckedChange={() => review.toggle(item)} aria-label={`Allow Ri to use ${item.name}`} /></div>}
      {!item.draft && <div className={s.setting}><span>Keep handy<small>Prefer this in your quick access row.</small></span><Switch checked={review.isPinned(item)} onCheckedChange={() => review.pin(item)} aria-label={`Keep ${item.name} handy`} /></div>}
      <div className={s.setting}><span>{item.kind === 'skills' ? 'Instructions and installation' : item.target.kind === 'provider' || item.target.kind === 'mcp' ? 'Accounts and access' : 'Settings and access'}<small>{item.kind === 'skills' ? 'Edit, move, try, or uninstall this skill.' : 'Update setup, permissions, or removal.'}</small></span><Button size="xs" variant="outline" onClick={() => review.manage(item)}><Settings2 size={12} />Manage</Button></div>
    </> : <>
      <div className="my-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">{item.view && <span className="flex items-center gap-1.5"><LayoutGrid size={13} />Opens in Ri</span>}{item.chat && <span className="flex items-center gap-1.5"><MessageCircle size={13} />Works in chat</span>}{item.kind === 'skills' && <span className="flex items-center gap-1.5"><BookOpen size={13} />Repeatable workflow</span>}</div>
      {item.target.kind === 'skill' ? <StoredSkillBody skillRef={item.target.ref} /> : item.catalog ? <CatalogDemo item={item} /> : item.starter ? <div className={s.demo}><span className={s.eyebrow}>The workflow</span><div className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{item.starter.body}</div></div> : <div className={s.demo}><h3>{item.added ? 'Ready for your work' : 'Make it available to Ri'}</h3><p className={s.muted}>{item.kind === 'skills' ? 'Open this skill to read its instructions, try it, or choose which agents use it.' : item.view ? 'Open the app to use its full interface and your records.' : 'Connect an account and choose its access. Then bring the information into a conversation.'}</p></div>}
      {!item.added && <p className={`${s.muted} mt-5`}>{item.kind === 'connectors' ? 'Connect your account, then choose what Ri can use.' : 'Preview and customize it before you choose to install it.'}</p>}
      {item.added && !item.draft && <div className="mt-5 flex items-center justify-between gap-2"><ItemStatus item={item} /><Button size="xs" variant="ghost" onClick={() => review.pin(item)} aria-pressed={review.isPinned(item)}><Pin size={12} />{review.isPinned(item) ? 'Kept handy' : 'Keep handy'}</Button></div>}
    </>}
  </section>;
}

function StoredSkillBody({ skillRef }: { skillRef: string }) {
  const skill = useSkill(skillRef);
  return <div className={s.demo}><span className={s.eyebrow}>Your instructions</span>{skill.error ? <p className={s.muted}>{skill.error.message}<Button size="xs" variant="ghost" onClick={() => void skill.refetch()}>Retry</Button></p> : <div className="mt-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{skill.data?.body || (skill.isPending ? 'Loading instructions…' : 'No instructions yet. Open the editor to write them.')}</div>}</div>;
}

export function WithInspector({ children }: { children: React.ReactNode }) {
  const review = useReview();
  return <div className={review.selected ? s.detailFrame : s.frame}>{children}{review.selected && <aside className={s.inspector}><ItemDetails item={review.selected} /></aside>}</div>;
}

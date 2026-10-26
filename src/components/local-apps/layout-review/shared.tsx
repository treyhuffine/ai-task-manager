'use client';

import { useRef, useState } from 'react';
import { ArrowRight, BookOpen, BriefcaseBusiness, ChevronDown, Hammer, House, LayoutGrid, PencilRuler, Plus, Search, Server, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useElementWidth } from '@/hooks/use-element-width';
import { INTEGRATION_LABELS } from '@/constants/integrations';
import { Tip } from '@/components/ui/tip';
import { COLLECTIONS, collectionItems, quickItems, type ReviewFilter, type ReviewItem } from './catalog';
import { useReview } from './context';
import { ItemCard, ItemMark, OwnedRow } from './items';
import s from './review.module.css';

export function AddYourOwn() {
  const review = useReview();
  const appInput = useRef<HTMLInputElement>(null);
  const skillInput = useRef<HTMLInputElement>(null);
  return <>
    <DropdownMenu><DropdownMenuTrigger asChild><Button size="xs"><Plus size={12} />Add your own<ChevronDown size={11} /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={!review.localEnabled || review.busy} onSelect={review.buildApp}><Hammer size={14} />Build an app</DropdownMenuItem>
        <DropdownMenuItem disabled={review.busy} onSelect={review.buildSkill}><BookOpen size={14} />Create a skill</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => review.patch({ mcp: 'new' })}><Server size={14} />Connect custom MCP</DropdownMenuItem>
        <DropdownMenuItem disabled={review.busy} onSelect={() => skillInput.current?.click()}><Upload size={14} />Import SKILL.md</DropdownMenuItem>
        <DropdownMenuItem disabled={!review.localEnabled || review.busy} onSelect={() => appInput.current?.click()}><Upload size={14} />Import app package</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <input type="file" ref={appInput} className="sr-only" accept=".gz,.tgz" aria-label="Import app package" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) review.importApp(file); }} />
    <input type="file" ref={skillInput} className="sr-only" accept=".md" aria-label="Import SKILL.md" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) review.importSkill(file); }} />
  </>;
}
export function LibraryButton() {
  const review = useReview();
  return <Button size="xs" variant={review.inLibrary ? 'secondary' : 'ghost'} onClick={review.showLibrary}>Your library <span className="tabular-nums text-muted-foreground">({review.library.length})</span></Button>;
}
export function Header({ title = 'Apps', subtitle = 'More ways to work with Ri.', children }: { title?: string; subtitle?: string; children?: React.ReactNode }) {
  const review = useReview();
  return <header className={s.header}><span className={s.mark}><LayoutGrid size={17} /></span><div className={s.headerCopy}><h1>{title}</h1><p>{subtitle}</p></div>
    <div className={s.actions}>{children}<Button size="xs" variant={review.inLibrary ? 'ghost' : 'secondary'} onClick={review.showDiscover}>Discover</Button><LibraryButton /><AddYourOwn /></div>
  </header>;
}
export function SectionTitle({ children, count, action }: { children: React.ReactNode; count?: number; action?: React.ReactNode }) {
  return <div className={s.sectionTitle}><h2>{children}{count !== undefined && <span>{count}</span>}</h2>{action}</div>;
}
export function SearchBox({ placeholder = 'Search a name or something you want to do' }: { placeholder?: string }) {
  const review = useReview();
  return <form role="search" className={s.search} onSubmit={event => { event.preventDefault(); review.commitSearch(); }}><Search size={15} />
    <Input type="search" aria-label="Search additions" value={review.search} onChange={event => review.setSearch(event.target.value)} onBlur={review.commitSearch} placeholder={placeholder} />
    {review.search && <Button className={s.searchClear} type="button" variant="ghost" size="icon-xs" aria-label="Clear search" onClick={review.clearSearch}><X size={12} /></Button>}
  </form>;
}
export function Filters({ availability = false }: { availability?: boolean }) {
  const review = useReview();
  const filters: ReviewFilter[] = availability ? ['All', 'Added', 'Available'] : ['All', 'Work', 'Life', 'Create'];
  const types: ReviewFilter[] = ['Apps', INTEGRATION_LABELS.plural, 'Skills', 'Custom MCP'];
  return <div className={s.filters} aria-label="Filter additions">{filters.map(filter => <button type="button" key={filter} className={s.filter} aria-pressed={review.filter === filter} onClick={() => review.patch({ filter: filter === 'All' ? undefined : filter })}>{filter}</button>)}
    <select className={s.typeFilter} aria-label="Type of addition" value={types.includes(review.filter) ? review.filter : ''} onChange={event => review.patch({ filter: event.target.value || undefined })}>
      <option value="">All types</option>{types.map(type => <option key={type}>{type}</option>)}
    </select>
  </div>;
}
export function Empty({ children = 'No matches. Try another name or a different filter.' }: { children?: React.ReactNode }) { return <div className={s.empty}>{children}</div>; }
export function Cards({ items, initial = 12 }: { items: ReviewItem[]; initial?: number }) {
  const [limit, setLimit] = useState(initial);
  if (!items.length) return <Empty />;
  return <><div className={s.grid}>{items.slice(0, limit).map(item => <ItemCard key={item.key} item={item} />)}</div>{items.length > limit && <div className={s.showMore}><Button variant="ghost" size="xs" onClick={() => setLimit(limit + 24)}>Show more <span className="text-muted-foreground">({items.length - limit})</span><ArrowRight size={12} /></Button></div>}</>;
}
export function QuickAccess() {
  const review = useReview();
  const [measure, width] = useElementWidth<HTMLDivElement>();
  const limit = Math.min(6, Math.max(1, Math.floor(((width ?? 500) + 8) / 146)));
  const items = quickItems(review.items, review.preferences.pinned, review.preferences.recent, limit);
  return <section aria-label="Quick access"><SectionTitle action={<LibraryButton />}>Quick access</SectionTitle><div ref={measure} className={s.quickRow}>
    {items.map(item => <Tip key={item.key} label={item.name} onlyWhenTextHidden><button type="button" className={s.shortcut} onClick={() => review.primary(item)}><ItemMark item={item} small /><span>{item.name}</span></button></Tip>)}
    {!items.length && <p className={s.muted}>Your recent additions will be handy here. Browse below to find your first one.</p>}
  </div></section>;
}
export function OwnedList({ limit }: { limit?: number }) {
  const review = useReview();
  const items = review.matching(review.library);
  return <>{(limit ? items.slice(0, limit) : items).map(item => <OwnedRow key={item.key} item={item} />)}{!items.length && <Empty>{review.search ? 'No matches in your library.' : 'Everything you add will appear here, including custom MCPs and skills.'}</Empty>}
    {limit && items.length > limit && <Button size="xs" variant="ghost" onClick={review.showLibrary}>View all {items.length}<ArrowRight size={12} /></Button>}</>;
}
export function CatalogDemo({ item, compact = false }: { item: ReviewItem; compact?: boolean }) {
  const demo = item.catalog?.demo;
  if (!demo) return <div className={s.demo}><span className={s.eyebrow}>{item.kind === 'skills' ? 'A way of working' : 'Works with Ri'}</span><h3>{item.name}</h3><p className={s.muted}>{item.description}</p><div className="mt-4"><ItemMark item={item} /></div></div>;
  return <div className={s.demo}><span className={s.eyebrow}>Sample data</span><h3>{demo.heading}</h3>{!compact && <p className={s.muted}>{demo.caption}</p>}<table><thead><tr>{demo.columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{demo.rows.slice(0, compact ? 2 : 4).map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>;
}
export function Featured() {
  const review = useReview();
  const item = review.items.find(item => item.catalog?.packageId === 'ri-travel' && !item.added) ?? review.items.find(item => item.catalog && !item.added);
  if (!item || review.search || review.filter !== 'All' || review.collection) return null;
  return <section className={s.hero} aria-label="Featured app"><div><span className={s.eyebrow}>Made for everyday life</span><h2>{item.catalog?.packageId === 'ri-travel' ? 'A whole trip, all together.' : item.name}</h2><p>{item.description}</p><Button size="sm" variant="outline" onClick={() => review.details(item)}>Explore {item.name}<ArrowRight size={13} /></Button></div><CatalogDemo item={item} compact /></section>;
}
export function Discovery({ featured = false, heading = 'Discover', initial = 12 }: { featured?: boolean; heading?: string; initial?: number }) {
  const review = useReview();
  // Give apps and skills room alongside the larger account catalog.
  const sorted = [...review.discovery].sort((a, b) => Number(a.kind === 'connectors') - Number(b.kind === 'connectors'));
  return <><SectionTitle count={review.discovery.length}>{review.collection?.name ?? heading}</SectionTitle><SearchBox /><Filters />{featured && <Featured />}
    {review.collection && <Button className="mb-4" variant="ghost" size="xs" onClick={() => review.patch({ collection: undefined })}>All additions<X size={12} /></Button>}
    {!review.loading && !review.discovery.length && !review.search && review.filter === 'All' ? <Empty>You have everything in this catalog. Explore your library or add something of your own.</Empty> : <Cards key={`${review.search}:${review.filter}:${review.collection?.id ?? ''}`} items={sorted} initial={initial} />}
  </>;
}
export function CollectionTiles() {
  const review = useReview();
  const icons = { business: BriefcaseBusiness, life: House, ideas: PencilRuler };
  return <div className={s.collectionGrid}>{COLLECTIONS.map(collection => {
    const Icon = icons[collection.id];
    return <button type="button" className={s.collectionTile} key={collection.id} aria-pressed={review.query.collection === collection.id} onClick={() => review.patch({ collection: collection.id, item: undefined })}>
      <Icon size={21} /><h3>{collection.name}</h3><p>{collection.description}</p><span className={s.collectionMarks}>{collectionItems(review.items, collection.id).slice(0, 4).map(item => <ItemMark key={item.key} item={item} small />)}</span>
    </button>;
  })}</div>;
}
export function LibraryPage() {
  const review = useReview();
  return <><Header title="Your library" subtitle="Everything you added, including custom MCPs and skills." /><div className={s.body}><div className={s.page}><SearchBox placeholder="Search your library" /><Filters />
    {!review.library.length && !review.search && review.filter === 'All' ? <Empty>Your library starts with what you add. Apps, connected accounts, custom MCPs, and skills will all be here.<div className="mt-3"><Button size="xs" variant="outline" onClick={review.showDiscover}>Browse additions</Button></div></Empty> : <Cards key={`${review.search}:${review.filter}`} items={review.matching(review.library)} initial={24} />}
    {!!review.matching(review.drafts).length && <section className={s.section}><SectionTitle count={review.drafts.length}>In progress</SectionTitle><p className={`${s.muted} mb-4`}>Drafts stay here until you decide to install them.</p><Cards items={review.matching(review.drafts)} /></section>}
  </div></div></>;
}

'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, LayoutGrid, MoreHorizontal, Plug, Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tip } from '@/components/ui/tip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { INTEGRATION_LABELS } from '@/constants/integrations';
import { AppLibrary } from '../../app-library';
import { AddAppDialog } from '../../add-app-dialog';
import { HubAccessList } from '../../hub-access';
import { NewAppDialog } from '../../new-app-dialog';
import { AppBuildsList } from '../../app-builds-list';
import type { LibraryFilter } from '../../library-model';
import { useReview } from '../context';
import { ItemDetails } from '../details';
import { ItemMark, ItemStatus, ManageButton, PrimaryButton } from '../items';
import { collectionItems, matchesReview, type ReviewFilter, type ReviewItem } from '../catalog';
import { SkillTry } from '../live-surfaces';
import { CatalogSkeleton, LibraryRowsSkeleton } from '../loading';
import { Cards, CollectionTiles, Empty, SearchBox, SectionTitle } from '../shared';
import s from '../review.module.css';

const GROUPS = [
  { kind: 'apps', label: 'Apps', description: 'Interfaces you work in.', Icon: LayoutGrid },
  { kind: 'connectors', label: INTEGRATION_LABELS.plural, description: 'Accounts and services Ri can access.', Icon: Plug },
  { kind: 'skills', label: 'Skills', description: 'Instructions and workflows you maintain.', Icon: BookOpen },
] as const;
const LIBRARY_FILTERS = [{ value: 'all', label: 'All' }, ...GROUPS.map(group => ({ value: group.kind, label: group.label }))];

export function SplitLibrary() {
  const review = useReview();
  const library = useRef<HTMLElement>(null);
  const pane = useRef<HTMLElement>(null);
  const libraryFilter = GROUPS.find(group => group.kind === review.query.libraryType)?.kind ?? 'all';
  useEffect(() => {
    if (review.query.browse === 'yours') library.current?.focus({ preventScroll: false });
  }, [review.query.browse]);
  useEffect(() => {
    if (!(review.query.provider || review.query.mcp || review.trySkill)) return;
    const root = pane.current?.closest('[data-apps-library]');
    if (root && root.clientWidth <= 760) pane.current?.scrollIntoView({ block: 'start' });
  }, [review.query.provider, review.query.mcp, review.trySkill]);
  const setup = !!review.query.provider || !!review.query.mcp;
  return <>
    <LibraryHeader />
    <div className={s.libraryColumns}>
      <section ref={library} tabIndex={-1} className={s.libraryPane} aria-label="Your library">
        <Tabs className={s.libraryTabs} value={libraryFilter} onValueChange={value => {
          review.patch({ libraryType: value === 'all' ? undefined : value });
          library.current?.scrollTo({ top: 0 });
        }}>
          <div className={s.libraryToolbar}>
            <SectionTitle count={Object.values(review.libraryLoading).some(Boolean) ? undefined : review.library.length}>Your library</SectionTitle>
            <TabsList className={s.libraryFilters} aria-label="Filter your library">
              {LIBRARY_FILTERS.map(filter => <TabsTrigger key={filter.value} value={filter.value}>{filter.label}</TabsTrigger>)}
            </TabsList>
          </div>
          <TabsContent className={s.libraryContents} value={libraryFilter}><GroupedLibrary filter={libraryFilter} /></TabsContent>
        </Tabs>
      </section>
      <section ref={pane} className={setup || review.trySkill ? s.workspacePane : s.discoveryPane} aria-label={setup ? 'Connection settings' : 'Discover and details'}>
        {setup ? <AppLibrary query={review.query} navigate={review.navigate} />
          : review.trySkill ? <SkillTry item={review.trySkill} />
          : review.selected ? <ItemDetails item={review.selected} />
          : review.collection ? <GoalBundle /> : <Discover />}
      </section>
    </div>
  </>;
}

function LibraryHeader() {
  const review = useReview();
  const skillInput = useRef<HTMLInputElement>(null);
  const [addingApp, setAddingApp] = useState(false);
  const [newApp, setNewApp] = useState(false);
  const newServer = () => {
    review.setTrySkill(null);
    review.patch({ mcp: 'new', provider: undefined, item: undefined, panel: undefined });
  };
  return <header className={s.libraryHeader}>
    <div className={s.libraryHeading}><span className={s.mark}><LayoutGrid size={18} /></span><div><h1>Apps</h1><p>Apps, {INTEGRATION_LABELS.plural.toLowerCase()}, and skills for your work.</p></div></div>
    <div className={s.creationActions} aria-label="Create and connect">
      <Button size="sm" variant="outline" onClick={() => setNewApp(true)}><Plus size={13} />New app</Button>
      <Button size="sm" variant="outline" onClick={() => setAddingApp(true)}><Plus size={13} />Add app</Button>
      <Button size="sm" variant="outline" disabled={review.busy} onClick={review.buildSkill}><Plus size={13} />New skill</Button>
      <Button size="sm" variant="outline" onClick={newServer}><Plus size={13} />Add MCP server</Button>
      <DropdownMenu><DropdownMenuTrigger asChild><Tip label="Import a skill"><Button className={s.importButton} size="icon-sm" variant="ghost" aria-label="Import options"><MoreHorizontal size={16} /></Button></Tip></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={review.busy} onSelect={() => skillInput.current?.click()}><Upload size={14} />Import SKILL.md</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <div className={s.librarySearch}><SearchBox placeholder="Search your library or find something new" /></div>
    <input type="file" ref={skillInput} className="sr-only" accept=".md" aria-label="Import SKILL.md" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) review.importSkill(file); }} />
    <AddAppDialog open={addingApp} onOpenChange={setAddingApp} />
    <NewAppDialog open={newApp} onOpenChange={setNewApp} onCreated={(id) => review.navigate(`build/${id}`)} />
  </header>;
}

function GroupedLibrary({ filter }: { filter: LibraryFilter }) {
  const review = useReview();
  // Catalog type filters never hide the other things a person already owns.
  const matching = review.library.filter(item => matchesReview(item, review.search));
  const drafts = review.drafts.filter(item => matchesReview(item, review.search) && (filter === 'all' || item.kind === filter));
  return <>
    {GROUPS.filter(group => filter === 'all' || group.kind === filter).map(({ kind, label, description, Icon }) => {
      const items = matching.filter(item => item.kind === kind);
      const loading = review.libraryLoading[kind];
      return <section className={s.libraryGroup} key={kind} aria-label={`Your ${label.toLowerCase()}`}>
        <div className={s.groupHeading}><Icon size={13} /><h3>{label}</h3>{!loading && <span>{items.length}</span>}</div>
        <p className={s.groupDescription}>{description}</p>
        {loading ? <LibraryRowsSkeleton label={label} /> : items.length ? items.map(item => <LibraryEntry key={item.key} item={item} />)
          : <p className={s.groupEmpty}>{review.search ? 'No matches.' : `No ${label.toLowerCase()} yet.`}</p>}
      </section>;
    })}
    {(filter === 'all' || filter === 'apps') && <div className={s.libraryGroup}><AppBuildsList onOpen={(id) => review.navigate(`build/${id}`)} /></div>}
    {(filter === 'all' || filter === 'apps') && <div className={s.libraryGroup}><HubAccessList /></div>}
    {!!drafts.length && <section className={s.libraryGroup} aria-label="In progress"><div className={s.groupHeading}><h3>In progress</h3><span>{drafts.length}</span></div>
      {drafts.map(item => <LibraryEntry key={item.key} item={item} />)}
    </section>}
  </>;
}

function LibraryEntry({ item }: { item: ReviewItem }) {
  const review = useReview();
  const action = item.draft ? 'Continue setup' : item.kind === 'skills' ? 'Edit skill' : item.view ? 'Open' : 'Manage connection';
  const open = () => item.draft || item.kind === 'skills' || !item.view ? review.manage(item) : review.primary(item);
  const selected = review.selected?.key === item.key || review.query.provider === (item.target.kind === 'provider' ? item.target.id : null) || review.query.mcp === (item.target.kind === 'mcp' ? item.target.id : null);
  return <div className={s.libraryEntry} data-item={item.key} data-selected={selected || undefined}>
    <Tip label={item.name} onlyWhenTextHidden><button type="button" className={s.ownedButton} onClick={open} aria-label={`${action} ${item.name}`} aria-current={selected ? 'true' : undefined}>
      <ItemMark item={item} small /><span><strong>{item.name}</strong><small className={item.attention ? s.attention : undefined}>{item.enabled === false ? 'Off' : item.attention ? 'Needs attention' : item.target.kind === 'mcp' ? 'Custom MCP' : item.status}</small></span>
    </button></Tip>
    <ManageButton item={item} />
  </div>;
}

function Discover() {
  const review = useReview();
  const types: ReviewFilter[] = ['All', 'Apps', INTEGRATION_LABELS.plural, 'Skills'];
  const sorted = [...review.discovery].sort((a, b) => Number(a.kind === 'connectors') - Number(b.kind === 'connectors'));
  const showGoals = !review.search && review.filter === 'All';
  return <>
    <div className={s.discoverHeading}><h2>Discover</h2><p>Find your next useful addition.</p></div>
    <div className={s.typeTabs} aria-label="Discover types">{types.map(type => <button type="button" key={type} className={s.filter} aria-pressed={review.filter === type} onClick={() => review.patch({ filter: type === 'All' ? undefined : type, browse: undefined })}>{type}</button>)}</div>
    {showGoals && <section className={s.goalSection} aria-label="Goal bundles"><SectionTitle>Start with a goal</SectionTitle><CollectionTiles /></section>}
    <SectionTitle count={review.loading ? undefined : sorted.length}>{review.search ? 'Search results' : showGoals ? 'Explore the catalog' : review.filter}</SectionTitle>
    {review.loading ? <CatalogSkeleton /> : !sorted.length && !review.search ? <Empty>You have everything in this part of the catalog. Try another type or create something of your own.</Empty>
      : <Cards items={sorted} />}
  </>;
}

function GoalBundle() {
  const review = useReview();
  if (review.loading) return <CatalogSkeleton />;
  const collection = review.collection!;
  const items = collectionItems(review.items, collection.id);
  const added = items.filter(item => item.added && !item.draft).length;
  const back = () => review.patch({ collection: undefined, item: undefined, panel: undefined });
  return <div className={s.goalContents}>
    <Button size="xs" variant="ghost" onClick={back}><ArrowLeft size={13} />Back to Discover</Button>
    <div className={s.goalHeading}><h2>{collection.name}</h2><p>{collection.description}</p><span>{added} of {items.length} in your library</span></div>
    <p className={`${s.muted} mb-4`}>Choose the pieces that help. Each has its own setup and access.</p>
    {items.map(item => <div className={s.bundleItem} key={item.key}>
      <button className={s.flatMain} type="button" onClick={() => review.details(item)} aria-label={`Details for ${item.name}`}><ItemMark item={item} /><span><h3>{item.name}</h3><p>{item.description}</p><small>{item.kind === 'skills' ? 'Skill' : item.kind === 'apps' ? 'App' : INTEGRATION_LABELS.singular}</small></span></button>
      <div className={s.bundleItemActions}>{item.added && !item.draft ? <ItemStatus item={item} /> : <span className={s.muted}>Not added</span>}<PrimaryButton item={item} /></div>
    </div>)}
    {!items.length && <Empty>No additions in this bundle are available yet.</Empty>}
    {added === items.length && !!items.length && <p className={`${s.muted} mt-5`}>Everything in this bundle is already in your library.</p>}
    <Button className="mt-5" size="xs" variant="ghost" onClick={back}>Browse all additions<ArrowRight size={12} /></Button>
  </div>;
}

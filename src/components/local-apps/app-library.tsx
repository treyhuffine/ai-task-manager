'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, BookOpen, Check, ChevronDown, Hammer, LayoutGrid, Loader2, MessageCircle, Plug, Plus, Search, Server, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { IntegrationLogo } from '@/components/integrations/integration-logo';
import { IntegrationsSection } from '@/components/settings/sections/integrations-section';
import { McpServersSection } from '@/components/settings/sections/plugins/mcp-servers-section';
import { useSettingsStore } from '@/components/settings/settings-store';
import { INTEGRATION_LABELS } from '@/constants/integrations';
import { useDashboard } from '@/contexts/dashboard-context';
import { useStartSkill } from '@/hooks/use-start-skill';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { AppHeader, PrimaryAction, QuietAction } from './app-header';
import { type LocalAppsList } from './app-hooks';
import { AppMark } from './app-mark';
import { draftRoute } from './app-places';
import { useAppAction } from './use-app-action';
import { IncludedApps } from './included-apps';
import { filterLibrary, libraryItems, libraryLocation, libraryRoute, type LibraryFilter, type LibraryItem } from './library-model';
import { useLibrary } from './use-library';
import { LibraryChat } from './library-chat';

const FILTERS: { value: LibraryFilter; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'apps', label: 'Apps' },
  { value: 'connectors', label: INTEGRATION_LABELS.plural }, { value: 'skills', label: 'Skills' },
];

export function AppLibrary({ data, localEnabled, localLoading, localError, query, navigate }: {
  data?: LocalAppsList;
  localEnabled: boolean;
  localLoading: boolean;
  localError?: Error | null;
  query: Record<string, string>;
  navigate: (route: string) => void;
}) {
  const location = libraryLocation(query);
  const qc = useQueryClient();
  const settings = useSettingsStore();
  const back = useCallback(() => {
    void qc.invalidateQueries({ queryKey: trpc.integrations.pathKey() });
    navigate(libraryRoute(query, { provider: undefined, mcp: undefined }));
  }, [qc, navigate, query]);
  const providerNavigation = useMemo(() => ({ providerId: location.provider ?? '', returnTo: `/apps${libraryRoute(query, {})}`, onBack: back }), [location.provider, query, back]);
  const mcpNavigation = useMemo(() => ({ serverId: location.mcp === 'new' ? null : location.mcp ?? null,
    returnTo: `/apps${libraryRoute(query, location.mcp === 'new' ? { mcp: undefined } : {})}`,
    onSelect: (id: string) => navigate(libraryRoute(query, { mcp: id })), onBack: back }), [location.mcp, query, navigate, back]);

  if (location.provider || location.mcp) return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <AppHeader title={location.mcp === 'new' ? 'Add custom MCP' : 'Connection'} mark={<LibraryMark />} onBack={back} subtitle="Accounts and access, shared with the rest of Ri." />
      <div className="min-h-0 flex-1 overflow-y-auto" data-settings-scroll>
        <div className="mx-auto max-w-3xl px-5 py-6 sm:px-8">
          {location.provider ? <IntegrationsSection active={!settings.open} navigation={providerNavigation} /> : <McpServersSection active={!settings.open} navigation={mcpNavigation} />}
        </div>
      </div>
    </div>
  );
  return <LibraryOverview data={data} localEnabled={localEnabled} localLoading={localLoading} localError={localError} query={query} navigate={navigate} />;
}

function LibraryOverview({ data, localEnabled, localLoading, localError, query, navigate }: Parameters<typeof AppLibrary>[0]) {
  const sources = useLibrary();
  const { openSkill } = useDashboard();
  const createSkill = useStartSkill();
  const { busy, run } = useAppAction();
  const fileInput = useRef<HTMLInputElement>(null);
  const [chatItem, setChatItem] = useState<LibraryItem | null>(null);
  const { mode, filter, search } = libraryLocation(query);
  const [searchDraft, setSearchDraft] = useState(search);
  // Back/Forward restores the exact library search. Typing itself stays local until navigation settles.
  const [lastSearch, setLastSearch] = useState(search);
  if (lastSearch !== search) { setLastSearch(search); setSearchDraft(search); }
  const items = useMemo(() => libraryItems({ apps: data, providers: sources.providers.data?.providers,
    connections: sources.connections.data?.connections, servers: sources.servers.data?.servers, skills: sources.skills.data?.skills }),
  [data, sources.providers.data, sources.connections.data, sources.servers.data, sources.skills.data]);
  const visible = filterLibrary(items, mode, filter, searchDraft);
  const patch = (values: Record<string, string | undefined>) => navigate(libraryRoute(query, { q: searchDraft || undefined, ...values }));
  const create = (profile: 'react' | 'html' | 'static' = 'react') => void run(async () => {
    const draft = await trpcClient.localApps.createDraft.mutate({ profile }); navigate(draftRoute(draft.id));
  });
  const open = (item: LibraryItem) => {
    const target = item.target;
    if (target.kind === 'app') navigate(target.slug);
    else if (target.kind === 'draft') navigate(draftRoute(target.id));
    else if (target.kind === 'skill') openSkill(target.ref);
    else patch({ [target.kind === 'provider' ? 'provider' : 'mcp']: target.id });
  };
  const openChat = (item: LibraryItem) => {
    if (item.target.kind === 'app') navigate(`${item.target.slug}?riChat=1`);
    else setChatItem(item);
  };
  const loading = localLoading || [sources.providers, sources.connections, sources.servers, sources.skills].some(result => result.isPending);
  const failures = [
    { name: 'Local apps', error: localError, retry: () => window.location.reload() },
    { name: INTEGRATION_LABELS.plural, error: sources.providers.error ?? sources.connections.error, retry: () => { void sources.providers.refetch(); void sources.connections.refetch(); } },
    { name: 'Custom MCP servers', error: sources.servers.error, retry: () => { void sources.servers.refetch(); } },
    { name: 'Skills', error: sources.skills.error, retry: () => { void sources.skills.refetch(); } },
  ].filter(result => result.error);
  const installed = items.filter(item => item.added && !item.draft);
  const groups = mode === 'yours' ? [
    { name: 'Apps', items: visible.filter(item => item.kind === 'apps' && !item.draft) },
    { name: INTEGRATION_LABELS.plural, items: visible.filter(item => item.kind === 'connectors') },
    { name: 'Skills', items: visible.filter(item => item.kind === 'skills' && !item.draft) },
    { name: 'In progress', items: visible.filter(item => item.draft) },
  ] : [{ name: INTEGRATION_LABELS.plural, items: visible }];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <AppHeader mark={<LibraryMark />} title="Apps" subtitle="Apps, connections, and skills for your work.">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><QuietAction icon={<Hammer size={13} />}>Build <ChevronDown size={11} /></QuietAction></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem disabled={!localEnabled || busy} onSelect={() => create()}><Hammer size={15} /><MenuCopy label="Build an app" detail="Create an interface you and your agent can use." /></DropdownMenuItem>
            <DropdownMenuItem disabled={createSkill.isPending} onSelect={createSkill.start}><BookOpen size={15} /><MenuCopy label="Create a skill" detail="Teach your agent a repeatable workflow." /></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><PrimaryAction icon={<Plus size={13} />}>Add <ChevronDown size={11} /></PrimaryAction></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onSelect={() => patch({ browse: 'discover', filter: undefined })}><Search size={15} /><MenuCopy label="Browse catalog" detail="Find something to add to your library." /></DropdownMenuItem>
            <DropdownMenuItem onSelect={() => patch({ browse: 'discover', filter: 'connectors' })}><Plug size={15} /><MenuCopy label="Connect a service" detail="Bring an account and its tools into Ri." /></DropdownMenuItem>
            <DropdownMenuItem onSelect={() => patch({ mcp: 'new' })}><Server size={15} /><MenuCopy label="Add custom MCP" detail="Connect a server and its tools." /></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!localEnabled || busy} onSelect={() => fileInput.current?.click()}><Upload size={15} />Import app package</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input ref={fileInput} type="file" accept=".gz,.tgz" className="sr-only" aria-label="Import app package" onChange={event => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (file) void run(async () => {
            const form = new FormData(); form.append('package', file);
            const response = await fetch('/api/local-apps/import', { method: 'POST', body: form });
            const result = await response.json(); if (!response.ok) throw new Error(result.error);
            navigate(draftRoute(result.id));
          });
        }} />
      </AppHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="@container mx-auto w-full max-w-5xl space-y-6 px-5 py-5 sm:px-8 sm:py-7">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border">
            <nav aria-label="Library views" className="flex gap-6">
              {([{ value: 'yours', label: 'Your library' }, { value: 'discover', label: 'Discover' }] as const).map(tab => (
                <button key={tab.value} type="button" aria-current={mode === tab.value ? 'page' : undefined} onClick={() => patch({ browse: tab.value === 'discover' ? 'discover' : undefined })}
                  className={cn('border-b-2 pb-3 text-sm font-medium transition-colors', mode === tab.value ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
                  {tab.label}{tab.value === 'yours' && installed.length > 0 && <span className="ml-2 text-xs tabular-nums text-muted-foreground">{installed.length}</span>}
                </button>
              ))}
            </nav>
            <p className="pb-3 text-xs text-muted-foreground">{mode === 'yours' ? 'Added once, available where you work.' : 'Connect an account or try an included app.'}</p>
          </div>
          <div className="space-y-3">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={searchDraft} onChange={event => setSearchDraft(event.target.value)} onBlur={() => { if (searchDraft !== search) patch({}); }}
                placeholder={mode === 'yours' ? 'Search apps, connections, and skills' : 'Search the catalog'} aria-label="Search library" className="h-10 rounded-lg pl-10 pr-10 text-sm" />
              {searchDraft && <button type="button" aria-label="Clear search" onClick={() => { setSearchDraft(''); navigate(libraryRoute(query, { q: undefined })); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"><X size={15} /></button>}
            </div>
            <div aria-label="Filter library" className="flex flex-wrap gap-1.5">
              {FILTERS.map(option => <button key={option.value} type="button" aria-pressed={filter === option.value} onClick={() => patch({ filter: option.value === 'all' ? undefined : option.value })}
                className={cn('rounded-full border px-3 py-1 text-xs transition-colors', filter === option.value ? 'border-foreground/15 bg-secondary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground')}>
                {option.label}
              </button>)}
            </div>
          </div>
          {failures.map(failure => <div key={failure.name} role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/20 px-3 py-2 text-xs"><span className="flex-1 text-destructive">{failure.name} could not load. {failure.error?.message}</span><Button variant="ghost" size="xs" onClick={failure.retry}>Retry</Button></div>)}
          {!localEnabled && !localLoading && !localError && filter === 'apps' && <p className="text-sm text-muted-foreground">Building and running local apps is disabled for this Home. Your connections and skills are still available.</p>}
          {loading && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" />Loading your library…</p>}
          {mode === 'discover' && localEnabled && (filter === 'all' || filter === 'apps') && <IncludedApps data={data} search={searchDraft} navigate={navigate} />}
          {groups.filter(group => group.items.length).map(group => <section key={group.name} aria-label={group.name} className="space-y-3">
            <div className="flex items-center gap-2"><h2 className="text-xs font-semibold text-foreground">{group.name}</h2><span className="text-xs tabular-nums text-muted-foreground">{group.items.length}</span></div>
            <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
              {(filter === 'all' && mode === 'yours' && group.name !== 'In progress' ? group.items.slice(0, 6) : group.items).map(item => <LibraryCard key={item.key} item={item} open={() => open(item)} chat={() => openChat(item)} />)}
            </div>
            {filter === 'all' && mode === 'yours' && group.name !== 'In progress' && group.items.length > 6 && <button type="button" onClick={() => patch({ filter: group.items[0].kind })} className="text-xs font-medium text-muted-foreground hover:text-foreground">Show all {group.items.length} {group.name.toLowerCase()}</button>}
          </section>)}
          {!loading && !visible.length && (mode === 'yours' || filter === 'connectors' || filter === 'skills') && <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-10 text-center">
            {filter === 'skills' ? <BookOpen size={24} className="mb-3 text-muted-foreground" /> : <LayoutGrid size={24} className="mb-3 text-muted-foreground" />}
            <h2 className="text-sm font-medium">{searchDraft ? 'Nothing matches your search' : filter === 'skills' ? 'Teach your agent a way of working' : 'Make room for the tools you need'}</h2>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{searchDraft ? 'Try a different name, account, or workflow.' : filter === 'skills' ? 'Create a skill for a workflow you repeat. It will appear here alongside your apps and connections.' : 'Connect a service, add an app, or build something for your own workflow.'}</p>
            <Button className="mt-4" size="sm" variant="outline" onClick={searchDraft ? () => { setSearchDraft(''); navigate(libraryRoute(query, { q: undefined })); } : filter === 'skills' ? createSkill.start : () => patch({ browse: 'discover' })}>
              {searchDraft ? 'Clear search' : filter === 'skills' ? 'Create a skill' : 'Discover apps'}
            </Button>
          </div>}
          {mode === 'yours' && installed.length > 0 && <button type="button" onClick={() => patch({ browse: 'discover', filter: undefined })} className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"><Plus size={14} />Find something else for your work<ArrowUpRight size={12} /></button>}
        </div>
      </div>
      <LibraryChat item={chatItem} onClose={() => setChatItem(null)} />
    </div>
  );
}

function LibraryMark() { return <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><LayoutGrid size={16} /></span>; }
function MenuCopy({ label, detail }: { label: string; detail: string }) { return <span><span className="block text-xs font-medium">{label}</span><span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{detail}</span></span>; }

function LibraryCard({ item, open, chat }: { item: LibraryItem; open: () => void; chat: () => void }) {
  return <article className="group flex min-w-0 flex-col rounded-xl border border-border bg-card/20 p-4 transition-colors hover:border-foreground/20">
    <button type="button" onClick={open} aria-label={`Details for ${item.name}`} className="flex min-w-0 items-start gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {item.providerId ? <IntegrationLogo providerId={item.providerId} name={item.name} size={36} /> : item.kind === 'skills' ? <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><BookOpen size={18} /></span> : item.target.kind === 'mcp' ? <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Server size={18} /></span> : <AppMark name={item.name} size="lg" />}
      <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold">{item.name}</h3><p className="mt-1 line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground">{item.description}</p></div>
    </button>
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {item.chat && !item.draft && <span className="inline-flex items-center gap-1"><MessageCircle size={11} />{item.kind === 'skills' ? 'Agent workflow' : 'Works in chat'}</span>}
      {item.view && <span className="inline-flex items-center gap-1"><LayoutGrid size={11} />Opens in Ri</span>}
      {item.draft && <span className="inline-flex items-center gap-1"><Hammer size={11} />In progress</span>}
    </div>
    <div className="mt-auto flex min-w-0 items-center justify-between gap-2 pt-4">
      <span className={cn('min-w-0 truncate text-[11px]', item.attention ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
        {item.added && !item.attention && !item.draft && <Check size={11} className="mr-1 inline" />}{item.status}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        {item.chat && item.added && item.usable !== false && !item.draft && !item.attention && item.kind !== 'skills' && <Button variant="ghost" size="xs" onClick={chat} aria-label={`Use ${item.name} in chat`}>Use in chat</Button>}
        <Button variant="outline" size="xs" onClick={open}>{item.draft ? 'Continue' : item.kind === 'skills' ? 'Edit skill' : item.view && item.usable !== false ? 'Open' : item.added ? 'Manage' : 'Connect'}</Button>
      </div>
    </div>
  </article>;
}

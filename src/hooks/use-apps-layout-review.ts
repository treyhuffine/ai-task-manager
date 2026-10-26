'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDashboard } from '@/contexts/dashboard-context';
import { useCreateSkill, SKILLS_KEY } from '@/hooks/use-skills';
import { useStartSkill } from '@/hooks/use-start-skill';
import { connectedAppsQuery } from '@/components/mcp-apps/catalog';
import type { AppLibrary } from '@/components/local-apps/app-library';
import { KEY } from '@/components/local-apps/app-hooks';
import { draftRoute } from '@/components/local-apps/app-places';
import { libraryRoute, type LibraryItem } from '@/components/local-apps/library-model';
import { useLibrary } from '@/components/local-apps/use-library';
import { useAppAction } from '@/components/local-apps/use-app-action';
import { COLLECTIONS, collectionItems, discoverable, matchesReview, primaryLabel, reviewItems, STARTER_SKILLS, type ReviewFilter, type ReviewItem } from '@/components/local-apps/layout-review/catalog';
import { isLayoutChoice, type LayoutId } from '@/components/local-apps/layout-review/options';
import { rememberItem, updateReviewPreferences, useReviewPreferences } from '@/components/local-apps/layout-review/preferences';
import { openAppChat } from '@/lib/client/app-pane';
import { parseSkillFile } from '@/lib/skills/format';
import { skillsApi } from '@/lib/api/skills';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { INTEGRATION_LABELS } from '@/constants/integrations';

export type AppsReviewProps = Omit<Parameters<typeof AppLibrary>[0], 'navigate'> & {
  navigate: (route: string, options?: { replace?: boolean }) => void;
};
export type AppsReview = ReturnType<typeof useAppsLayoutReview>;

/** All twelve screens share these queries and operations. Layouts never own installed state. */
export function useAppsLayoutReview(props: AppsReviewProps, layout: LayoutId) {
  const { data, query, navigate, localEnabled } = props;
  const sources = useLibrary();
  const connected = useQuery(connectedAppsQuery());
  const catalog = useQuery({ queryKey: [...KEY, 'catalog'], queryFn: () => trpcClient.localApps.catalog.query(), enabled: localEnabled });
  const qc = useQueryClient();
  const dashboard = useDashboard();
  const preferences = useReviewPreferences();
  const { busy, run } = useAppAction();
  const createSkill = useCreateSkill();
  const newSkill = useStartSkill();
  const [chatItem, setChatItem] = useState<LibraryItem | null>(null);
  const [trySkill, setTrySkill] = useState<ReviewItem | null>(null);
  const [settingsKey, setSettingsKey] = useState<string | null>(null);
  const [search, setSearch] = useState(query.q ?? '');
  const [lastSearch, setLastSearch] = useState(query.q ?? '');
  if (lastSearch !== (query.q ?? '')) { setLastSearch(query.q ?? ''); setSearch(query.q ?? ''); }
  const items = useMemo(() => reviewItems({ apps: data, providers: sources.providers.data?.providers,
    connections: sources.connections.data?.connections, servers: sources.servers.data?.servers,
    skills: sources.skills.data?.skills, connectedApps: connected.data }, catalog.data),
  [data, sources.providers.data, sources.connections.data, sources.servers.data, sources.skills.data, connected.data, catalog.data]);
  const filter = (['All', 'Work', 'Life', 'Create', 'Added', 'Available', 'Apps', 'Skills', 'Custom MCP', INTEGRATION_LABELS.plural].includes(query.filter) ? query.filter : 'All') as ReviewFilter;
  const library = items.filter(item => item.added && !item.draft);
  const drafts = items.filter(item => item.draft);
  const selected = items.find(item => item.key === query.item) ?? null;
  const inLibrary = query.browse === 'yours';
  const collection = COLLECTIONS.find(group => group.id === query.collection);
  const patch = (values: Record<string, string | undefined>) => navigate(libraryRoute(query, { layout, q: search || undefined, ...values }));
  const matching = (list: ReviewItem[]) => list.filter(item => matchesReview(item, search, filter));
  const discovered = items.filter(discoverable);
  const available = discovered.filter(item => !item.added || item.draft);
  const discovery = matching(collection ? collectionItems(items, collection.id) : search || filter !== 'All' ? discovered : available);
  const showLibrary = () => patch({ browse: 'yours', item: undefined, panel: undefined, app: undefined, collection: undefined, filter: undefined });
  const showDiscover = () => patch({ browse: undefined, item: undefined, panel: undefined, app: undefined, collection: undefined, filter: undefined });
  const details = (item: ReviewItem, settings = false) => patch({ item: item.key, panel: settings ? 'settings' : undefined });
  const manage = (item: ReviewItem) => {
    const target = item.target;
    if (target.kind === 'app') setSettingsKey(item.key);
    else if (target.kind === 'skill') dashboard.openSkill(target.ref);
    else if (target.kind === 'draft') navigate(draftRoute(target.id));
    else if (target.kind === 'provider' || target.kind === 'mcp') patch({ [target.kind === 'provider' ? 'provider' : 'mcp']: target.id });
    else details(item);
  };
  const open = (item: ReviewItem) => {
    const target = item.target;
    rememberItem(item.key);
    if (item.view && item.added && ['tabs', 'shelf', 'preview'].includes(layout)) { patch({ app: item.key, item: item.key }); return; }
    if (item.connectedAppId) navigate(`~connected/${item.connectedAppId}`);
    else if (target.kind === 'app') navigate(target.slug);
    else manage(item);
  };
  const chat = (item: ReviewItem) => {
    const target = item.target;
    rememberItem(item.key);
    if (target.kind === 'skill') setTrySkill(item);
    else if (target.kind === 'app') { openAppChat(target.id); navigate(`${target.slug}?riChat=1`); }
    else if (target.kind === 'provider' || target.kind === 'mcp') setChatItem({ ...item, target });
  };
  const add = (item: ReviewItem) => void run(async () => {
    const target = item.target;
    if (target.kind === 'catalog-app') {
      const draft = await trpcClient.localApps.addCatalog.mutate({ packageId: target.packageId });
      navigate(draftRoute(draft.id));
    } else if (target.kind === 'catalog-skill') {
      const starter = STARTER_SKILLS.find(starter => starter.id === target.id)!;
      const { skill } = await createSkill.mutateAsync({ name: starter.id, description: starter.description, body: starter.body });
      dashboard.openSkill(skill.ref);
    } else manage(item);
  });
  const primary = (item: ReviewItem) => {
    if (!item.added) add(item);
    else if (primaryLabel(item) === 'Manage' || item.draft) manage(item);
    else if (item.view) open(item);
    else chat(item);
  };
  const toggle = (item: ReviewItem) => void run(async () => {
    if (item.target.kind === 'app' && data) {
      await trpcClient.localApps.configure.mutate({ id: item.target.id, revision: data.revision, patch: { enabled: !item.enabled, archived: false } });
    } else if (item.target.kind === 'mcp') {
      await trpcClient.integrations.mcpServersPatch.mutate({ params: { id: item.target.id }, body: { enabled: !item.enabled } });
      await qc.invalidateQueries({ queryKey: trpc.integrations.pathKey() });
      await qc.invalidateQueries({ queryKey: trpc.connectedApps.pathKey() });
    }
  });
  const buildApp = () => void run(async () => { const draft = await trpcClient.localApps.createDraft.mutate({ profile: 'react' }); navigate(draftRoute(draft.id)); });
  const importApp = (file: File) => void run(async () => {
    const form = new FormData(); form.append('package', file);
    const response = await fetch('/api/local-apps/import', { method: 'POST', body: form });
    const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Could not import this package.');
    navigate(draftRoute(result.id));
  });
  const importSkill = (file: File) => void run(async () => {
    if (file.size > 2_000_000) throw new Error('Choose a SKILL.md file smaller than 2 MB.');
    const content = await file.text(); const parsed = parseSkillFile(content);
    if (parsed.frontmatterError) throw new Error(parsed.frontmatterError);
    if (!parsed.name) throw new Error('This skill needs a name in its frontmatter.');
    const existing = sources.skills.data?.skills.find(skill => skill.name === parsed.name && skill.location.kind === 'draft');
    if (existing) throw new Error('A draft with this name already exists. Open it from your library or rename the imported skill.');
    const { skill } = await createSkill.mutateAsync({ name: parsed.name, description: parsed.description ?? '', body: parsed.body });
    // Preserve arbitrary frontmatter and comments as well as the instructions.
    await skillsApi.save(skill.ref, { content, baseHash: skill.hash });
    await qc.invalidateQueries({ queryKey: SKILLS_KEY }); dashboard.openSkill(skill.ref);
  });
  const refresh = () => { void qc.invalidateQueries({ queryKey: trpc.integrations.pathKey() }); void qc.invalidateQueries({ queryKey: trpc.connectedApps.pathKey() }); void qc.invalidateQueries({ queryKey: SKILLS_KEY }); };
  const failures = [
    { name: 'Apps', error: props.localError, retry: () => void qc.invalidateQueries({ queryKey: KEY }) },
    { name: 'App catalog', error: catalog.error, retry: () => void catalog.refetch() },
    { name: INTEGRATION_LABELS.plural, error: sources.providers.error ?? sources.connections.error, retry: refresh },
    { name: 'Custom MCPs', error: sources.servers.error, retry: refresh },
    { name: 'Skills', error: sources.skills.error, retry: refresh },
    { name: 'Connected apps', error: connected.error, retry: () => void connected.refetch() },
  ].filter(failure => failure.error);
  const loading = props.localLoading || sources.providers.isPending || sources.connections.isPending || sources.servers.isPending || sources.skills.isPending || (localEnabled && catalog.isPending);
  const settingsItem = items.find(item => item.key === settingsKey);
  const settingsTarget = settingsItem?.target;
  const settingsInstance = settingsTarget?.kind === 'app' ? data?.instances.find(instance => instance.id === settingsTarget.id) : undefined;
  return { ...props, layout, items, library, drafts, discovered, discovery, selected, inLibrary, collection, matching, filter,
    search, setSearch, commitSearch: () => { if (search !== (query.q ?? '')) patch({}); }, clearSearch: () => { setSearch(''); patch({ q: undefined }); },
    preferences, busy: busy || createSkill.isPending || newSkill.isPending, loading, failures, patch, showLibrary, showDiscover, details, manage, open, chat, primary, toggle,
    buildApp, buildSkill: newSkill.start, importApp, importSkill, chatItem, setChatItem, trySkill, setTrySkill,
    settingsInstance, closeSettings: () => setSettingsKey(null),
    pin: (item: ReviewItem) => updateReviewPreferences(previous => ({ ...previous, pinned: previous.pinned.includes(item.key) ? previous.pinned.filter(key => key !== item.key) : [...previous.pinned, item.key] })),
    isPinned: (item: ReviewItem) => preferences.pinned.includes(item.key),
    selectedApp: items.find(item => item.key === query.app) ?? null,
    sources,
  };
}

export function layoutFromQuery(query: Record<string, string>, stored: string) {
  return isLayoutChoice(query.layout) ? query.layout : isLayoutChoice(stored) ? stored : 'discover';
}

'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useDashboard } from '@/contexts/dashboard-context';
import { useCreateSkill, SKILLS_KEY } from '@/hooks/use-skills';
import { useStartSkill } from '@/hooks/use-start-skill';
import { connectedAppsQuery } from '@/components/mcp-apps/catalog';
import { libraryRoute, type LibraryItem } from '@/components/apps/library-model';
import { useLibrary } from '@/components/apps/use-library';
import { COLLECTIONS, collectionItems, discoverable, matchesReview, primaryLabel, reviewItems, STARTER_SKILLS, type ReviewFilter, type ReviewItem } from '@/components/apps/layout-review/catalog';
import { parseSkillFile } from '@/lib/skills/format';
import { skillsApi } from '@/lib/api/skills';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { INTEGRATION_LABELS } from '@/constants/integrations';

export interface AppsReviewProps {
  query: Record<string, string>;
  navigate: (route: string, options?: { replace?: boolean }) => void;
}
export type AppsReview = ReturnType<typeof useAppsLayoutReview>;

/** Library, discovery and settings share the existing queries and operations. */
export function useAppsLayoutReview(props: AppsReviewProps) {
  const { query, navigate } = props;
  const sources = useLibrary();
  const connected = useQuery(connectedAppsQuery());
  const qc = useQueryClient();
  const dashboard = useDashboard();
  const createSkill = useCreateSkill();
  const newSkill = useStartSkill();
  const [running, setRunning] = useState(false);
  const [chatItem, setChatItem] = useState<LibraryItem | null>(null);
  const [trySkill, setTrySkill] = useState<ReviewItem | null>(null);
  const [search, setSearch] = useState(query.q ?? '');
  const [lastSearch, setLastSearch] = useState(query.q ?? '');
  if (lastSearch !== (query.q ?? '')) { setLastSearch(query.q ?? ''); setSearch(query.q ?? ''); }
  const items = useMemo(() => reviewItems({ providers: sources.providers.data?.providers,
    connections: sources.connections.data?.connections, servers: sources.servers.data?.servers,
    skills: sources.skills.data?.skills, connectedApps: connected.data }),
  [sources.providers.data, sources.connections.data, sources.servers.data, sources.skills.data, connected.data]);
  const filter = (['All', 'Apps', 'Skills', INTEGRATION_LABELS.plural].includes(query.filter) ? query.filter : 'All') as ReviewFilter;
  const library = items.filter(item => item.added && !item.draft);
  const drafts = items.filter(item => item.draft);
  const selected = items.find(item => item.key === query.item) ?? null;
  const inLibrary = query.browse === 'yours';
  const collection = COLLECTIONS.find(group => group.id === query.collection);
  const patch = (values: Record<string, string | undefined>) => navigate(libraryRoute(query, { filter: filter === 'All' ? undefined : filter, q: search || undefined, ...values }));
  const matching = (list: ReviewItem[]) => list.filter(item => matchesReview(item, search, filter));
  const discovered = items.filter(discoverable);
  const available = discovered.filter(item => !item.added || item.draft);
  const discovery = matching(collection ? collectionItems(items, collection.id) : search || filter !== 'All' ? discovered : available);
  /** Runs one library operation at a time, with a toast when it fails. */
  const run = async (operation: () => Promise<unknown>) => {
    setRunning(true);
    try { await operation(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'That didn’t work. Try again.'); }
    finally { setRunning(false); }
  };
  const showLibrary = () => patch({ browse: 'yours', item: undefined, panel: undefined, collection: undefined, filter: undefined });
  const showDiscover = () => patch({ browse: undefined, item: undefined, panel: undefined, collection: undefined, filter: undefined });
  const details = (item: ReviewItem, settings = false) => {
    setTrySkill(null);
    patch({ item: item.key, panel: settings ? 'settings' : undefined, provider: undefined, mcp: undefined });
  };
  const manage = (item: ReviewItem) => {
    const target = item.target;
    if (target.kind === 'skill') dashboard.openSkill(target.ref);
    else if (target.kind === 'provider' || target.kind === 'mcp') {
      setTrySkill(null);
      patch({ provider: undefined, mcp: undefined, item: undefined, panel: undefined, [target.kind === 'provider' ? 'provider' : 'mcp']: target.id });
    }
    else details(item);
  };
  const open = (item: ReviewItem) => {
    if (item.connectedAppId) navigate(`~connected/${item.connectedAppId}`);
    else manage(item);
  };
  const chat = (item: ReviewItem) => {
    const target = item.target;
    if (target.kind === 'skill') setTrySkill(item);
    else if (target.kind === 'provider' || target.kind === 'mcp') setChatItem({ ...item, target });
  };
  const add = (item: ReviewItem) => void run(async () => {
    const target = item.target;
    if (target.kind === 'catalog-skill') {
      const starter = STARTER_SKILLS.find(starter => starter.id === target.id)!;
      const { skill } = await createSkill.mutateAsync({ name: starter.id, description: starter.description, body: starter.body });
      dashboard.openSkill(skill.ref);
    } else manage(item);
  });
  const primary = (item: ReviewItem) => {
    if (!item.added) add(item);
    else if (['Manage', 'Manage connection', 'Edit skill'].includes(primaryLabel(item)) || item.draft) manage(item);
    else if (item.view) open(item);
    else chat(item);
  };
  const toggle = (item: ReviewItem) => void run(async () => {
    if (item.target.kind !== 'mcp') return;
    await trpcClient.integrations.mcpServersPatch.mutate({ params: { id: item.target.id }, body: { enabled: !item.enabled } });
    await qc.invalidateQueries({ queryKey: trpc.integrations.pathKey() });
    await qc.invalidateQueries({ queryKey: trpc.connectedApps.pathKey() });
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
    { name: INTEGRATION_LABELS.plural, error: sources.providers.error ?? sources.connections.error, retry: refresh },
    { name: 'Custom MCPs', error: sources.servers.error, retry: refresh },
    { name: 'Skills', error: sources.skills.error, retry: refresh },
    { name: 'Connected apps', error: connected.error, retry: () => void connected.refetch() },
  ].filter(failure => failure.error);
  // Apps are connections whose server supplies an interface, so they load with the connections.
  const connectionsLoading = sources.providers.isPending || sources.connections.isPending || sources.servers.isPending || connected.isPending;
  const libraryLoading = { apps: connectionsLoading, connectors: connectionsLoading, skills: sources.skills.isPending };
  const loading = connectionsLoading || libraryLoading.skills;
  return { ...props, items, library, drafts, discovered, discovery, selected, inLibrary, collection, matching, filter,
    search, setSearch, commitSearch: () => { if (search !== (query.q ?? '')) patch({}); }, clearSearch: () => { setSearch(''); patch({ q: undefined }); },
    busy: running || createSkill.isPending || newSkill.isPending, loading, libraryLoading, failures, patch, showLibrary, showDiscover, details, manage, open, chat, primary, toggle,
    buildSkill: newSkill.start, importSkill, chatItem, setChatItem, trySkill, setTrySkill,
    sources,
  };
}

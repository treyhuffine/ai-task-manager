'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Search, Server } from 'lucide-react';
import { trpcClient } from '@/lib/trpc/client';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';
import { setSettingsAnchor, useSettingsStore } from '@/components/settings/settings-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsSkeleton } from '@/components/settings/settings-skeleton';
import { openIntegrationAuthorization } from '@/lib/client/desktop';
import { clearMcpToolApprovals, DEFAULT_MCP_APPROVAL_POLICY, patchMcpToolOverrides, type McpApprovalPolicy, type McpToolApprovalPatch } from '@/lib/integrations/mcp-approval-policy';
import { CatalogTile, McpLogo } from '../integrations/parts';
import { McpServerDetail, McpServerForm, mcpTone } from '../integrations/mcp-server-detail';
import { McpDefaultPermissions } from '../integrations/mcp-permissions';
import { EMPTY_MCP_FORM, errMsg, type McpForm, type McpServerEntry } from '../integrations/types';
import { watchOAuthReturn } from '../integrations/oauth-focus-refresh';
import { PLUGIN_CREATE_ANCHORS } from './navigation';

type View = { kind: 'catalog' } | { kind: 'new' } | { kind: 'server'; id: string };

/** Custom servers have their own management view and an immediately available add form. */
export function McpServersSection({ active, navigation }: {
  active: boolean;
  /** Reuse the same setup/actions in Apps, leaving Settings navigation alone. */
  navigation?: { serverId: string | null; returnTo?: string; onSelect: (id: string) => void; onBack: () => void };
}) {
  const { anchor, requestId } = useSettingsStore();
  const [view, setView] = useState<View>(() => navigation
    ? navigation.serverId ? { kind: 'server', id: navigation.serverId } : { kind: 'new' }
    : anchor === PLUGIN_CREATE_ANCHORS.mcpServer ? { kind: 'new' } : { kind: 'catalog' });
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [settings, setSettings] = useState<{ defaultPolicy: McpApprovalPolicy; override: McpApprovalPolicy | null }>({ defaultPolicy: DEFAULT_MCP_APPROVAL_POLICY, override: null });
  const [form, setForm] = useState<McpForm>(EMPTY_MCP_FORM);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [pendingOAuth, setPendingOAuth] = useState<string | null>(null);
  const [awaitingServer, setAwaitingServer] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const openedRequest = useRef<number | null>(null);
  const catalogScroll = useRef(0);

  const refresh = useCallback(async () => {
    const result = await trpcClient.integrations.mcpServersGet.query({});
    setServers(result.servers.filter(server => !server.providerId));
    setSettings(result.approvalSettings);
    return result.servers;
  }, []);

  useEffect(() => { refresh().catch(error => setError(errMsg(error))).finally(() => setLoading(false)); }, [refresh]);

  const navigate = useCallback((next: View) => {
    if (view.kind === 'catalog') catalogScroll.current = rootRef.current?.closest('[data-settings-scroll]')?.scrollTop ?? 0;
    setView(next); setError(null); setBanner(null);
    if (navigation) {
      if (next.kind === 'server') navigation.onSelect(next.id);
      else if (next.kind === 'catalog') navigation.onBack();
    } else setSettingsAnchor(next.kind === 'new' ? PLUGIN_CREATE_ANCHORS.mcpServer : next.kind === 'server' ? `mcp:${next.id}` : 'mcp');
  }, [view.kind, navigation]);
  const back = useCallback(() => navigate({ kind: 'catalog' }), [navigate]);

  useEffect(() => {
    if (navigation || !active || openedRequest.current === requestId) return;
    openedRequest.current = requestId;
    if (anchor === PLUGIN_CREATE_ANCHORS.mcpServer) navigate({ kind: 'new' });
    else if (anchor?.startsWith('mcp:')) navigate({ kind: 'server', id: anchor.slice(4) });
    else if (anchor === 'mcp') back();
  }, [active, anchor, requestId, navigate, back, navigation]);

  const appServerId = navigation?.serverId;
  useEffect(() => {
    if (appServerId !== undefined) setView(appServerId ? { kind: 'server', id: appServerId } : { kind: 'new' });
  }, [appServerId]);

  // Web sign-in returns into this tab. Read its result after opening the detail
  // so navigation does not clear the feedback, then remove the one-time query.
  useEffect(() => {
    if (!active) return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const error = params.get('error');
    if (connected) setBanner(`Connected ${connected}`);
    else if (error) setError(`Connect failed: ${error}`);
    if (!connected && !error) return;
    params.delete('connected'); params.delete('error');
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params}${window.location.hash}`);
  }, [active]);

  useLayoutEffect(() => {
    if (!active) return;
    const pane = rootRef.current?.closest('[data-settings-scroll]');
    if (pane) pane.scrollTop = view.kind === 'catalog' ? catalogScroll.current : 0;
    if (view.kind === 'new') rootRef.current?.querySelector<HTMLInputElement>('#mcp-name')?.focus({ preventScroll: true });
  }, [active, view, requestId]);

  useEffect(() => {
    if (!active || view.kind === 'catalog') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || !matchesHotkey(event, HOTKEYS.slideoutBack)) return;
      if (document.querySelector('[data-slot="select-content"]')) return;
      event.preventDefault(); back();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, view.kind, back]);

  useEffect(() => {
    if (!awaitingServer) return;
    return watchOAuthReturn(window, async () => {
      await trpcClient.integrations.connectionsGet.query({});
      return (await refresh()).find(server => server.id === awaitingServer)?.lastStatus === 'ok';
    }, () => { setAwaitingServer(null); setPendingOAuth(null); setForm(EMPTY_MCP_FORM); setBanner('MCP server connected'); }, error => setError(errMsg(error)));
  }, [awaitingServer, refresh]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await operation(); await refresh(); }
    catch (error) { setError(errMsg(error)); }
    finally { setBusy(false); }
  };
  const authorize = async (url: string, flowId?: string) => {
    if (flowId) setPendingOAuth(flowId);
    try { await openIntegrationAuthorization(url); }
    catch (error) {
      if (flowId) await trpcClient.desktop.cancelOAuth.mutate({ body: { id: flowId } }).catch(() => {});
      setPendingOAuth(null); throw error;
    }
  };
  const add = () => run(async () => {
    const auth = form.authKind === 'header' ? { kind: 'header' as const, header: form.header.trim() } : { kind: form.authKind };
    const result = await trpcClient.integrations.mcpServersPost.mutate({ body: { name: form.name.trim(), url: form.url.trim(), auth,
      ...(navigation?.returnTo ? { returnTo: navigation.returnTo } : {}),
      ...(['bearer', 'header'].includes(form.authKind) ? { secret: form.secret } : {}) } });
    setServers(list => [...list.filter(server => server.id !== result.entry.id), result.entry]);
    navigate({ kind: 'server', id: result.entry.id });
    if ('requiresAuth' in result && result.requiresAuth && 'authUrl' in result && result.authUrl) {
      setAwaitingServer(result.entry.id);
      await authorize(result.authUrl, 'desktopFlowId' in result ? result.desktopFlowId : undefined);
    } else { setForm(EMPTY_MCP_FORM); setBanner(`Added ${result.entry.displayName}`); }
  });

  const setServerPolicy = (server: McpServerEntry, approvalPolicy: McpApprovalPolicy | null) => {
    setBusy(true); setError(null);
    setServers(list => list.map(entry => entry.id === server.id ? { ...entry, approvalPolicy: approvalPolicy ?? undefined, toolOverrides: clearMcpToolApprovals(entry.toolOverrides) } : entry));
    trpcClient.integrations.mcpServersPatch.mutate({ params: { id: server.id }, body: { approvalPolicy, resetToolApprovals: true } })
      .then(result => setServers(list => list.map(entry => entry.id === server.id ? result.entry : entry)))
      .catch(error => { setServers(list => list.map(entry => entry.id === server.id ? server : entry)); setError(errMsg(error)); refresh().catch(() => {}); })
      .finally(() => setBusy(false));
  };
  const setToolOverride = (server: McpServerEntry, name: string, patch: McpToolApprovalPatch) => {
    setBusy(true); setError(null);
    setServers(list => list.map(entry => entry.id === server.id ? { ...entry, toolOverrides: patchMcpToolOverrides(entry.toolOverrides, { [name]: patch }) } : entry));
    trpcClient.integrations.mcpServersPatch.mutate({ params: { id: server.id }, body: { toolOverrides: { [name]: patch } } })
      .then(result => setServers(list => list.map(entry => entry.id === server.id ? result.entry : entry)))
      .catch(error => { setServers(list => list.map(entry => entry.id === server.id ? server : entry)); setError(errMsg(error)); refresh().catch(() => {}); })
      .finally(() => setBusy(false));
  };
  const setDefault = (defaultPolicy: McpApprovalPolicy | null, applyToAll = false) => {
    setBusy(true); setError(null);
    trpcClient.integrations.mcpApprovalPolicyPatch.mutate({ body: { defaultPolicy, applyToAll } })
      .then(result => { setSettings(result.approvalSettings); setServers(result.servers.filter(server => !server.providerId)); if (applyToAll) setBanner('Permissions applied to all MCP servers'); })
      .catch(error => setError(errMsg(error))).finally(() => setBusy(false));
  };

  const server = view.kind === 'server' ? servers.find(server => server.id === view.id) : undefined;
  const stale = !loading && view.kind === 'server' && !server;
  useEffect(() => { if (active && stale) back(); }, [active, stale, back]);
  const q = query.trim().toLowerCase();
  const visible = servers.filter(server => !q || `${server.displayName} ${server.url}`.toLowerCase().includes(q)).sort((a, b) => a.displayName.localeCompare(b.displayName));

  return <div ref={rootRef} className="@container space-y-5">
    {pendingOAuth && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-xs"><span>Finish connecting in your browser.</span>
      <Button size="xs" variant="outline" disabled={busy} onClick={() => run(async () => { await trpcClient.desktop.cancelOAuth.mutate({ body: { id: pendingOAuth } }); setPendingOAuth(null); setAwaitingServer(null); })}>Cancel</Button></div>}
    {banner && <div role="status" className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={15} className="shrink-0" /><p>{banner}</p></div>}
    {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive"><AlertCircle size={15} className="shrink-0" /><p>{error}</p></div>}
    {view.kind === 'new' ? <McpServerForm form={form} busy={busy} onChange={patch => setForm(form => ({ ...form, ...patch }))} onSubmit={add} onBack={back} />
      : loading ? <SettingsSkeleton rows={3} />
      : server ? <McpServerDetail server={server} busy={busy} defaultPolicy={settings.defaultPolicy} onBack={back}
        onSetPolicy={policy => setServerPolicy(server, policy)} onToolOverride={(name, patch) => setToolOverride(server, name, patch)}
        onAuthorize={() => run(async () => { const result = await trpcClient.integrations.mcpServerPost.mutate({ params: { id: server.id }, body: { ...(navigation?.returnTo ? { returnTo: navigation.returnTo } : {}) } }); if ('authUrl' in result && result.authUrl) { setAwaitingServer(server.id); await authorize(result.authUrl, 'desktopFlowId' in result ? result.desktopFlowId : undefined); } })}
        onRetest={() => run(async () => { await trpcClient.integrations.mcpServersPatch.mutate({ params: { id: server.id }, body: {} }); await trpcClient.integrations.connectionsGet.query({}); })}
        onToggleEnabled={() => run(async () => { await trpcClient.integrations.mcpServersPatch.mutate({ params: { id: server.id }, body: { enabled: !server.enabled } }); })}
        onRemove={() => run(async () => { await trpcClient.integrations.mcpServersDelete.mutate({ params: { id: server.id } }); if (awaitingServer === server.id) { setAwaitingServer(null); setPendingOAuth(null); } navigate({ kind: 'catalog' }); setBanner(`Removed ${server.displayName}`); })}
        onReviewCapabilities={revision => run(async () => { try { await trpcClient.integrations.mcpServersPatch.mutate({ params: { id: server.id }, body: { reviewedRevision: revision } }); } catch (error) { await refresh().catch(() => {}); throw error; } })} />
      : <>
        <p className="text-xs text-muted-foreground">Connect a custom MCP server by URL, then manage its tools and permissions here.</p>
        <McpDefaultPermissions override={settings.override} busy={busy} serverCount={servers.length} onChange={policy => setDefault(policy)} onApplyToAll={() => setDefault(settings.override, true)} />
        {servers.length > 0 && <div className="relative"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search MCP servers" placeholder="Search MCP servers" value={query} onChange={event => setQuery(event.target.value)} className="rounded-4xl pl-9 text-xs" /></div>}
        {visible.length ? <div className="grid grid-cols-1 gap-2 @lg:grid-cols-2">{visible.map(server => { const status = mcpTone(server); return <CatalogTile key={server.id} logo={<McpLogo size={36} dim={!server.enabled} />} name={server.displayName}
          subtitle={server.url} tone={status.tone} toneLabel={status.label} onOpen={() => navigate({ kind: 'server', id: server.id })} />; })}</div>
          : <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center"><Server size={20} className="text-muted-foreground" /><p className="text-xs font-medium">{q ? 'No MCP servers match your search' : 'No MCP servers yet'}</p><p className="text-[11px] text-muted-foreground">{q ? 'Try a name or server URL.' : 'Use Add MCP server above to connect your first one.'}</p></div>}
      </>}
  </div>;
}

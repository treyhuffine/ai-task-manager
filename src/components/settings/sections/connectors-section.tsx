'use client';

/**
 * Connectors settings pane: connect external services so agents can act on your
 * behalf. Two levels, like an app store:
 *
 *   - Catalog. Every provider (and remote MCP server) is a tile whose only
 *     affordance is "open". Connected ones group at the top with the account
 *     they hold, the rest group by category, and search spans all of it.
 *   - Detail. One connector at a time: accounts (test, disconnect), the connect
 *     flow that fits the provider (OAuth sign-in, own OAuth app, or paste-a-key),
 *     the tools agents can call with an Ask first switch per write, and the
 *     Advanced bring-your-own OAuth app. Esc or "All connectors" steps back and
 *     the catalog keeps its scroll position.
 *
 * Single source of truth for connect mechanics is the engine API
 * (/connectors/status|connections|toolkits|connect|connectDirect|...). This pane
 * only adds presentation: logos (connector-logo.tsx) and grouping/copy
 * (connector-meta.ts). State and API calls live here; the views under
 * `./connectors/` are presentational.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Plug, Plus, Search } from 'lucide-react';
import { api } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';
import { openConnectorAuthorization } from '@/lib/client/desktop';
import { ConnectorLogo } from '@/components/connectors/connector-logo';
import { connectorMeta, CATEGORY_ORDER, type ConnectorCategory } from '@/components/connectors/connector-meta';
import { SettingsSkeleton } from '@/components/settings/settings-skeleton';
import { CatalogTile, GroupHeading, McpLogo } from './connectors/parts';
import { ProviderDetail } from './connectors/provider-detail';
import { McpServerDetail, McpServerForm, mcpTone } from './connectors/mcp-server-detail';
import {
  connectionIdentity,
  EMPTY_BYO_FORM,
  EMPTY_MCP_FORM,
  errMsg,
  type ApprovalMode,
  type AuthConfigSummary,
  type ByoForm,
  type Connection,
  type McpForm,
  type McpServerEntry,
  type McpToolOverride,
  type ProviderStatus,
  type TestResult,
  type ToolkitInfo,
  type WritePolicyAction,
} from './connectors/types';

type View =
  | { kind: 'catalog' }
  | { kind: 'provider'; id: string }
  | { kind: 'mcp'; id: string }
  | { kind: 'mcp-new' };

const CATALOG: View = { kind: 'catalog' };

/** Nearest scrolling ancestor: the settings modal's content pane owns the scroll. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const { overflowY } = getComputedStyle(n);
    if (overflowY === 'auto' || overflowY === 'scroll') return n;
  }
  return null;
}

/** "https://mcp.sentry.dev/sse" → "mcp.sentry.dev". Falls back to the raw string. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

const byName = (a: { displayName: string }, b: { displayName: string }) => a.displayName.localeCompare(b.displayName);

/** Tile subtitle for a connected provider: the account it holds, not the marketing line. */
function connectedSubtitle(p: ProviderStatus, conns: Connection[]): string {
  const who = conns.map(connectionIdentity).filter((w) => w && w !== p.displayName);
  if (who.length === 0) {
    return conns.length > 1 ? `${conns.length} accounts` : connectorMeta(p.id).description;
  }
  return who.length > 1 ? `${who[0]} and ${who.length - 1} more` : who[0]!;
}

export function ConnectorsSection() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [toolkits, setToolkits] = useState<ToolkitInfo[]>([]);
  const [writePolicy, setWritePolicy] = useState<Record<string, WritePolicyAction>>({}); // actionId → effective approval mode
  const [redirectUri, setRedirectUri] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [pendingOAuth, setPendingOAuth] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const [view, setView] = useState<View>(CATALOG);
  const [advancedOpen, setAdvancedOpen] = useState(false); // detail view's "Use your own OAuth app"
  const rootRef = useRef<HTMLDivElement>(null);
  const catalogScroll = useRef(0);

  const [creds, setCreds] = useState<Record<string, Record<string, string>>>({});
  const [serviceSel, setServiceSel] = useState<Record<string, string[]>>({}); // providerId → selected toolkit ids at connect (§5)
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // BYO OAuth app state (per provider).
  const [byoConfigs, setByoConfigs] = useState<Record<string, AuthConfigSummary[]>>({});
  const [byoForm, setByoForm] = useState<Record<string, ByoForm>>({});

  // MCP servers (ingest external MCP as connectors).
  const [mcpServers, setMcpServers] = useState<McpServerEntry[]>([]);
  const [mcpForm, setMcpForm] = useState<McpForm>(EMPTY_MCP_FORM);

  const providerScopes = useCallback(
    (providerId: string): string[] => {
      const set = new Set<string>();
      for (const t of toolkits) if (t.providerId === providerId) for (const s of t.scopes) set.add(s);
      return [...set];
    },
    [toolkits],
  );
  const providerToolkits = useCallback(
    (providerId: string): ToolkitInfo[] => toolkits.filter((t) => t.providerId === providerId),
    [toolkits],
  );
  /** Scopes to request at connect — only the user-selected services (default: all of them, §5). */
  const connectScopes = useCallback(
    (p: ProviderStatus): string[] => {
      const sel = serviceSel[p.id];
      if (!sel) return providerScopes(p.id);
      const set = new Set<string>();
      for (const t of toolkits) if (t.providerId === p.id && sel.includes(t.id)) for (const s of t.scopes) set.add(s);
      return [...set];
    },
    [serviceSel, toolkits, providerScopes],
  );
  const toggleService = (providerId: string, toolkitId: string) =>
    setServiceSel((prev) => {
      const all = toolkits.filter((t) => t.providerId === providerId).map((t) => t.id);
      const cur = prev[providerId] ?? all;
      const next = cur.includes(toolkitId) ? cur.filter((id) => id !== toolkitId) : [...cur, toolkitId];
      return { ...prev, [providerId]: next };
    });

  const refresh = useCallback(async () => {
    const [st, cn, tk, wp] = await Promise.all([
      api.get<{ redirectUri: string; providers: ProviderStatus[] }>('/connectors/status'),
      api.get<{ connections: Connection[] }>('/connectors/connections'),
      api.get<{ toolkits: ToolkitInfo[] }>('/connectors/toolkits'),
      api.get<{ toolkits: { actions: (WritePolicyAction & { id: string })[] }[] }>('/connectors/write-policy'),
    ]);
    setProviders(st.providers);
    setRedirectUri(st.redirectUri);
    setConnections(cn.connections);
    setToolkits(tk.toolkits);
    const wpMap: Record<string, WritePolicyAction> = {};
    for (const t of wp.toolkits) for (const a of t.actions) wpMap[a.id] = { mode: a.mode, defaultMode: a.defaultMode, overridden: a.overridden };
    setWritePolicy(wpMap);
    // Fetch MCP server health AFTER the runtime-touching calls above (which force a rebuild +
    // re-ingest), so the health reflects the latest ingest, not a pre-rebuild snapshot.
    const mcp = await api.get<{ servers: McpServerEntry[] }>('/connectors/mcp-servers');
    setMcpServers(mcp.servers);
  }, []);

  // Read the post-OAuth result the callback bounced back with, then strip it
  // from the URL (keep ?settings=connectors so the modal stays put).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const err = params.get('error');
    if (connected) setBanner(connected === 'Connected' ? 'Connected' : `Connected ${connected}`);
    else if (err) setError(`Connect failed: ${err}`);
    if (connected || err) {
      params.delete('connected');
      params.delete('error');
      const qs = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
    }
    refresh()
      .catch((e) => setError(errMsg(e)))
      .finally(() => setIsLoading(false));
  }, [refresh]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        await refresh();
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  // --- Navigation ----------------------------------------------------------

  const navigate = useCallback(
    (next: View) => {
      if (view.kind === 'catalog') catalogScroll.current = scrollParent(rootRef.current)?.scrollTop ?? 0;
      setView(next);
      setAdvancedOpen(false);
      setError(null);
      setBanner(null);
    },
    [view.kind],
  );
  const back = useCallback(() => navigate(CATALOG), [navigate]);

  // A detail opens at its top; the catalog comes back where it was left.
  useLayoutEffect(() => {
    const pane = scrollParent(rootRef.current);
    if (pane) pane.scrollTop = view.kind === 'catalog' ? catalogScroll.current : 0;
  }, [view]);

  // Esc inside a detail steps back to the catalog instead of closing Settings.
  // This window-level capture listener runs before Radix's document-level one,
  // and Radix skips its dismiss when the event is already default-prevented.
  useEffect(() => {
    if (view.kind === 'catalog') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || !matchesHotkey(e, HOTKEYS.slideoutBack)) return;
      e.preventDefault();
      back();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [view.kind, back]);

  // --- MCP servers ---------------------------------------------------------

  const addMcp = () =>
    run(async () => {
      const f = mcpForm;
      const auth =
        f.authKind === 'oauth'
          ? { kind: 'oauth' as const }
          : f.authKind === 'bearer'
            ? { kind: 'bearer' as const }
            : f.authKind === 'header'
              ? { kind: 'header' as const, header: f.header.trim() }
              : { kind: 'none' as const };
      const usesSecret = f.authKind === 'bearer' || f.authKind === 'header';
      const r = await api.post<{ toolCount?: number; requiresAuth?: boolean; authUrl?: string; desktopFlowId?: string }>(
        '/connectors/mcp-servers',
        { name: f.name.trim(), url: f.url.trim(), auth, ...(usesSecret ? { secret: f.secret } : {}) },
      );
      if (r.requiresAuth && r.authUrl) {
        await authorize(r.authUrl, r.desktopFlowId);
        return;
      }
      setMcpForm(EMPTY_MCP_FORM);
      navigate(CATALOG);
      setBanner(
        `Added ${f.name.trim()}${typeof r.toolCount === 'number' ? ` (${r.toolCount} tool${r.toolCount === 1 ? '' : 's'})` : ''}`,
      );
    });
  const authorizeMcp = (id: string) =>
    run(async () => {
      const r = await api.post<{ requiresAuth?: boolean; authUrl?: string; desktopFlowId?: string }>(`/connectors/mcp-servers/${id}`, {});
      if (r.requiresAuth && r.authUrl) await authorize(r.authUrl, r.desktopFlowId);
    });

  // Once the refresh drops the server, the stale-view guard below returns to the catalog.
  const removeMcp = (s: McpServerEntry) =>
    run(async () => {
      await api.delete(`/connectors/mcp-servers/${s.id}`);
      setBanner(`Removed ${s.displayName}`);
    });
  const toggleMcp = (s: McpServerEntry) =>
    run(() => api.patch(`/connectors/mcp-servers/${s.id}`, { enabled: !s.enabled }).then(() => {}));
  const retestMcp = (id: string) =>
    run(async () => {
      await api.patch(`/connectors/mcp-servers/${id}`, {}); // invalidate
      await api.get('/connectors/connections'); // force a rebuild so health refreshes
    });
  // Per-tool switches apply optimistically: the list never locks or flashes while
  // the patch lands, and a failure restores server truth.
  const setMcpToolOverride = (s: McpServerEntry, toolName: string, patch: McpToolOverride) => {
    const current = s.toolOverrides ?? {};
    const toolOverrides = { ...current, [toolName]: { ...current[toolName], ...patch } };
    setMcpServers((list) => list.map((x) => (x.id === s.id ? { ...x, toolOverrides } : x)));
    api.patch(`/connectors/mcp-servers/${s.id}`, { toolOverrides }).catch((e) => {
      setError(errMsg(e));
      refresh().catch(() => {});
    });
  };

  // Flip a mutating action between running on standing intent ('auto') and pausing
  // for a per-call approval ('ask'). Optimistic, like the MCP tool switches.
  // Landing back on the default clears the override instead of pinning it, so
  // the "changed" marker only ever means "differs from the default".
  const setActionApproval = (actionId: string, mode: ApprovalMode) => {
    const prev = writePolicy[actionId];
    if (!prev) return;
    const override = mode === prev.defaultMode ? null : mode;
    setWritePolicy((wp) => ({ ...wp, [actionId]: { ...prev, mode, overridden: override !== null } }));
    api.post('/connectors/write-policy', { actionId, mode: override }).catch((e) => {
      setWritePolicy((wp) => ({ ...wp, [actionId]: prev }));
      setError(errMsg(e));
    });
  };

  // --- Bring-your-own OAuth app -------------------------------------------

  const loadByo = useCallback(async (providerId: string) => {
    const { configs } = await api.get<{ configs: AuthConfigSummary[] }>(
      `/connectors/auth-configs?providerId=${encodeURIComponent(providerId)}`,
    );
    setByoConfigs((c) => ({ ...c, [providerId]: configs }));
  }, []);

  const setByoField = (providerId: string, field: keyof ByoForm, value: string) =>
    setByoForm((f) => ({ ...f, [providerId]: { ...(f[providerId] ?? EMPTY_BYO_FORM), [field]: value } }));

  const addByo = (p: ProviderStatus) =>
    run(async () => {
      const form = byoForm[p.id];
      if (!form?.label || !form?.clientId) {
        setError('Label and client ID are required.');
        return;
      }
      await api.post('/connectors/auth-configs', {
        providerId: p.id,
        label: form.label,
        oauth: { clientId: form.clientId, redirectUri: p.desktopCallback ? p.desktopCallback.redirectUri || 'http://127.0.0.1/oauth/callback' : redirectUri },
        clientSecret: form.clientSecret || undefined,
      });
      setByoForm((f) => ({ ...f, [p.id]: EMPTY_BYO_FORM }));
      await loadByo(p.id);
      setBanner(`Added your ${p.displayName} app`);
    });

  const deleteByo = (p: ProviderStatus, id: string) =>
    run(async () => {
      await api.delete(`/connectors/auth-configs?id=${encodeURIComponent(id)}`);
      await loadByo(p.id);
    });

  const setDefaultByo = (p: ProviderStatus, id: string) =>
    run(async () => {
      await api.post('/connectors/auth-configs/default', { providerId: p.id, id });
      await loadByo(p.id);
    });

  const copyRedirect = () => {
    void navigator.clipboard?.writeText((view.kind === 'provider' && providers.find((p) => p.id === view.id)?.desktopCallback?.redirectUri) || redirectUri).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  // --- Connect flows -------------------------------------------------------

  const authorize = useCallback(async (url: string, flowId?: string) => {
    if (flowId) setPendingOAuth(flowId);
    try { await openConnectorAuthorization(url); }
    catch (error) {
      if (flowId) await api.post('/desktop/oauth/cancel', { id: flowId }).catch(() => {});
      setPendingOAuth(null);
      throw error;
    }
  }, []);

  const openProvider = (p: ProviderStatus) => {
    navigate({ kind: 'provider', id: p.id });
    // OAuth details show the bring-your-own apps, so have them ready on arrival.
    if (p.method === 'oauth2' && !p.orphan) loadByo(p.id).catch(() => {});
  };

  const connectOAuth = useCallback(
    async (p: ProviderStatus, authConfigId?: string) => {
      setBusy(true);
      setError(null);
      try {
        const { authorizationUrl, desktopFlowId } = await api.post<{ authorizationUrl: string; desktopFlowId?: string }>('/connectors/connect', {
          providerId: p.id,
          scopes: connectScopes(p),
          label: p.displayName,
          ...(authConfigId ? { authConfigId } : {}),
        });
        await authorize(authorizationUrl, desktopFlowId);
        if (desktopFlowId) setBusy(false);
      } catch (e) {
        // Multi-client provider with no default → open Advanced so the user picks one.
        if ((e as { body?: { error?: string } }).body?.error === 'auth_config_required') {
          setAdvancedOpen(true);
          await loadByo(p.id).catch(() => {});
          setError('This provider has more than one OAuth app. Pick one under Use your own OAuth app to connect.');
        } else {
          setError(errMsg(e));
        }
        setBusy(false);
      }
    },
    [connectScopes, loadByo, authorize],
  );

  const connectDirect = (p: ProviderStatus) =>
    run(async () => {
      const { connection } = await api.post<{
        connection?: { email?: string | null; label?: string | null; accountId?: string };
      }>('/connectors/connectDirect', { providerId: p.id, fields: creds[p.id] ?? {}, label: p.displayName });
      setCreds((c) => ({ ...c, [p.id]: {} }));
      // Show the identity the engine discovered (identify()) so the connect lands with confidence.
      const who = connection?.email || connection?.accountId;
      setBanner(who ? `Connected ${p.displayName} as ${who}` : `Connected ${p.displayName}`);
    });

  const disconnect = (c: Connection) =>
    run(async () => {
      await api.post('/connectors/disconnect', { id: c.id });
      setBanner(`Disconnected ${connectionIdentity(c)}`);
    });

  const testConnection = async (id: string) => {
    setTesting(id);
    try {
      const res = await api.post<TestResult>('/connectors/test', { id });
      setTestResults((prev) => ({ ...prev, [id]: res }));
      await refresh(); // the probe may have healed the stored status
    } catch (e) {
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, status: 'error', error: errMsg(e) } }));
    } finally {
      setTesting(null);
    }
  };

  // --- Derived view --------------------------------------------------------

  const connectionsByProvider = useMemo(() => {
    const m = new Map<string, Connection[]>();
    for (const c of connections) m.set(c.providerId, [...(m.get(c.providerId) ?? []), c]);
    return m;
  }, [connections]);

  // Every provider the engine offers, plus any connection whose provider it no
  // longer lists, so that account can still be tested and disconnected.
  const catalogProviders = useMemo(() => {
    const known = new Set(providers.map((p) => p.id));
    const orphans: ProviderStatus[] = [...connectionsByProvider.keys()]
      .filter((id) => !known.has(id))
      .map((id) => ({ id, displayName: id, method: 'custom', configured: false, credentialFields: [], orphan: true }));
    return [...providers, ...orphans];
  }, [providers, connectionsByProvider]);

  const q = query.trim().toLowerCase();
  const catalog = useMemo(() => {
    const matches = (p: ProviderStatus) => {
      if (!q) return true;
      const meta = connectorMeta(p.id);
      return (
        p.displayName.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        meta.description.toLowerCase().includes(q) ||
        meta.category.toLowerCase().includes(q)
      );
    };
    const visible = catalogProviders.filter(matches);
    const connected = visible.filter((p) => connectionsByProvider.has(p.id)).sort(byName);
    const groups: { category: ConnectorCategory; items: ProviderStatus[] }[] = [];
    for (const category of CATEGORY_ORDER) {
      const items = visible
        .filter((p) => !connectionsByProvider.has(p.id) && connectorMeta(p.id).category === category)
        .sort(byName);
      if (items.length) groups.push({ category, items });
    }
    const servers = mcpServers.filter(
      (s) => !q || s.displayName.toLowerCase().includes(q) || s.url.toLowerCase().includes(q),
    );
    const total = connected.length + groups.reduce((n, g) => n + g.items.length, 0) + servers.length;
    return { connected, groups, servers, total };
  }, [q, catalogProviders, connectionsByProvider, mcpServers]);

  const selectedProvider = view.kind === 'provider' ? catalogProviders.find((p) => p.id === view.id) : undefined;
  const selectedServer = view.kind === 'mcp' ? mcpServers.find((s) => s.id === view.id) : undefined;
  // The selected connector vanished (a removed MCP server, a provider the engine
  // dropped): fall back to the catalog rather than render an empty detail.
  const stale = (view.kind === 'provider' && !selectedProvider) || (view.kind === 'mcp' && !selectedServer);
  if (stale) setView(CATALOG);

  if (isLoading) {
    return <SettingsSkeleton rows={5} />;
  }

  const onCatalog = view.kind === 'catalog' || stale;

  return (
    <div ref={rootRef} className="@container space-y-6">
      {pendingOAuth && (
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
          <span>Finish connecting in your browser.</span>
          <Button variant="outline" size="sm" onClick={() => void run(async () => {
            await api.post('/desktop/oauth/cancel', { id: pendingOAuth });
            setPendingOAuth(null);
          })}>Cancel</Button>
        </div>
      )}
      {banner && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <p className="font-medium">{banner}</p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-xs text-destructive">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div className="space-y-1">
            <h5 className="font-semibold">Action Failed</h5>
            <p className="opacity-90">{error}</p>
          </div>
        </div>
      )}

      {onCatalog ? (
        <>
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search connectors"
              aria-label="Search connectors"
              className="rounded-4xl pl-9 pr-9 text-xs"
            />
            {busy && (
              <Loader2
                size={14}
                aria-label="Working"
                className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground"
              />
            )}
          </div>

          {q && catalog.total === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/10 p-8 text-center">
              <div className="mb-3 rounded-full bg-muted/60 p-3 text-muted-foreground">
                <Plug size={22} />
              </div>
              <h3 className="text-xs font-semibold text-foreground">No connectors match “{query}”</h3>
              <p className="mt-1 text-[11px] text-muted-foreground">Try a different name or category.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {catalog.connected.length > 0 && (
                <section className="space-y-2">
                  <GroupHeading count={catalog.connected.length}>Connected</GroupHeading>
                  <TileGrid>
                    {catalog.connected.map((p) => {
                      const conns = connectionsByProvider.get(p.id) ?? [];
                      const healthy = conns.every((c) => c.status === 'active');
                      return (
                        <CatalogTile
                          key={p.id}
                          logo={<ConnectorLogo providerId={p.id} name={p.displayName} size={36} />}
                          name={p.displayName}
                          subtitle={connectedSubtitle(p, conns)}
                          tone={healthy ? 'ok' : 'warn'}
                          toneLabel={healthy ? 'Connected' : 'Needs attention'}
                          onOpen={() => openProvider(p)}
                        />
                      );
                    })}
                  </TileGrid>
                </section>
              )}

              {catalog.groups.map(({ category, items }) => (
                <section key={category} className="space-y-2">
                  <GroupHeading>{category}</GroupHeading>
                  <TileGrid>
                    {items.map((p) => (
                      <CatalogTile
                        key={p.id}
                        logo={<ConnectorLogo providerId={p.id} name={p.displayName} size={36} />}
                        name={p.displayName}
                        subtitle={connectorMeta(p.id).description}
                        onOpen={() => openProvider(p)}
                      />
                    ))}
                  </TileGrid>
                </section>
              ))}

              {(!q || catalog.servers.length > 0) && (
                <section className="space-y-2">
                  <GroupHeading
                    action={
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => navigate({ kind: 'mcp-new' })}
                        className="text-xs"
                      >
                        <Plus size={12} /> Add server
                      </Button>
                    }
                  >
                    MCP servers
                  </GroupHeading>
                  {catalog.servers.length > 0 ? (
                    <TileGrid>
                      {catalog.servers.map((s) => {
                        const status = mcpTone(s);
                        const tools = s.lastToolCount ?? s.tools?.length;
                        return (
                          <CatalogTile
                            key={s.id}
                            logo={<McpLogo size={36} dim={!s.enabled} />}
                            name={s.displayName}
                            subtitle={
                              typeof tools === 'number'
                                ? `${hostOf(s.url)} · ${tools} tool${tools === 1 ? '' : 's'}`
                                : hostOf(s.url)
                            }
                            tone={status.tone}
                            toneLabel={status.label}
                            onOpen={() => navigate({ kind: 'mcp', id: s.id })}
                          />
                        );
                      })}
                    </TileGrid>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Add a remote MCP server and its tools become connectors, behind your approval gate.
                    </p>
                  )}
                </section>
              )}
            </div>
          )}
        </>
      ) : view.kind === 'mcp-new' ? (
        <McpServerForm
          form={mcpForm}
          busy={busy}
          onChange={(patch) => setMcpForm((f) => ({ ...f, ...patch }))}
          onSubmit={addMcp}
          onBack={back}
        />
      ) : selectedServer ? (
        <McpServerDetail
          key={selectedServer.id}
          server={selectedServer}
          busy={busy}
          onBack={back}
          onAuthorize={() => authorizeMcp(selectedServer.id)}
          onRetest={() => retestMcp(selectedServer.id)}
          onToggleEnabled={() => toggleMcp(selectedServer)}
          onRemove={() => removeMcp(selectedServer)}
          onToolOverride={(toolName, patch) => setMcpToolOverride(selectedServer, toolName, patch)}
        />
      ) : selectedProvider ? (
        <ProviderDetail
          key={selectedProvider.id}
          provider={selectedProvider}
          connections={connectionsByProvider.get(selectedProvider.id) ?? []}
          toolkits={providerToolkits(selectedProvider.id)}
          writePolicy={writePolicy}
          busy={busy}
          testing={testing}
          testResults={testResults}
          creds={creds[selectedProvider.id] ?? {}}
          selectedServices={
            serviceSel[selectedProvider.id] ?? providerToolkits(selectedProvider.id).map((t) => t.id)
          }
          advancedOpen={advancedOpen}
          redirectUri={redirectUri}
          copied={copied}
          byoConfigs={byoConfigs[selectedProvider.id] ?? []}
          byoForm={byoForm[selectedProvider.id] ?? EMPTY_BYO_FORM}
          onBack={back}
          onConnectOAuth={(authConfigId) => connectOAuth(selectedProvider, authConfigId)}
          onConnectDirect={() => connectDirect(selectedProvider)}
          onCredChange={(field, value) =>
            setCreds((c) => ({ ...c, [selectedProvider.id]: { ...(c[selectedProvider.id] ?? {}), [field]: value } }))
          }
          onToggleService={(toolkitId) => toggleService(selectedProvider.id, toolkitId)}
          onTest={testConnection}
          onDisconnect={(id) => {
            const c = connections.find((x) => x.id === id);
            if (c) disconnect(c);
          }}
          onSetApproval={setActionApproval}
          onToggleAdvanced={() => setAdvancedOpen((v) => !v)}
          onCopyRedirect={copyRedirect}
          onByoField={(field, value) => setByoField(selectedProvider.id, field, value)}
          onByoAdd={() => addByo(selectedProvider)}
          onByoSetDefault={(id) => setDefaultByo(selectedProvider, id)}
          onByoDelete={(id) => deleteByo(selectedProvider, id)}
        />
      ) : null}
    </div>
  );
}

/** Two tiles per row once the pane is wide enough, keyed off the pane, not the viewport. */
function TileGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-2 @lg:grid-cols-2">{children}</div>;
}

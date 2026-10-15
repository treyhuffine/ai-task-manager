'use client';

import { INTEGRATION_LABELS } from '@/constants/integrations';
import { trpcClient } from '@/lib/trpc/client';
import { rpcQuery } from '@/lib/trpc/request-options';
/**
 * The Integrations tab of Plugins (./plugins-section.tsx): connect external
 * services so agents can act on your behalf. Two levels, like an app store:
 *
 *   - Catalog. Every provider is a tile whose only
 *     affordance is "open". Connected ones group at the top with the account
 *     they hold, the rest group by category, and search spans all of it.
 *   - Detail. One integration at a time: accounts (test, disconnect), the connect
 *     flow that fits the provider (OAuth sign-in, own OAuth app, or paste-a-key),
 *     the tools agents can call with an Ask first switch per write, and the
 *     Advanced bring-your-own OAuth app. Esc or "All integrations" steps back and
 *     the catalog keeps its scroll position.
 *
 * Single source of truth for connect mechanics is the engine API
 * (/integrations/status|connections|toolkits|connect|connectDirect|...). This pane
 * only adds presentation: logos (integration-logo.tsx) and grouping/copy
 * (integration-meta.ts). State and API calls live here; the views under
 * `./integrations/` are presentational.
 */
import { IntegrationLogo } from '@/components/integrations/integration-logo';
import { CATEGORY_ORDER, integrationMeta, type IntegrationCategory } from '@/components/integrations/integration-meta';
import { SettingsSkeleton } from '@/components/settings/settings-skeleton';
import { setSettingsAnchor, useSettingsStore } from '@/components/settings/settings-store';
import { PLUGIN_CREATE_ANCHORS } from './plugins/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';
import { type HostedEndpointSelection } from '@/lib/client/integration-endpoint';
import { openIntegrationAuthorization } from '@/lib/client/desktop';
import { AlertCircle, CheckCircle2, Loader2, Plug, Search } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { hostedAccountRequestFields, hostedAccountSignedIn } from './integrations/hosted-account-request';
import { watchOAuthReturn } from './integrations/oauth-focus-refresh';
import { CatalogTile, GroupHeading } from './integrations/parts';
import { PreviousConnections } from './integrations/previous-connections';
import { ProviderDetail } from './integrations/provider-detail';
import {
	connectionIdentity,
	EMPTY_BYO_FORM,
	errMsg,
	isRegisteredMcp,
	oauthAppRedirectUri,
	type ApprovalMode,
	type AuthConfigSummary,
	type ByoForm,
	type Connection,
	type HostedConnectIntent,
	type ProviderStatus,
	type TestResult,
	type ToolkitInfo,
	type WritePolicyAction,
} from './integrations/types';

type View =
  | { kind: 'catalog' }
  | { kind: 'provider'; id: string };

const CATALOG: View = { kind: 'catalog' };

/** Nearest scrolling ancestor: the settings modal's content pane owns the scroll. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const { overflowY } = getComputedStyle(n);
    if (overflowY === 'auto' || overflowY === 'scroll') return n;
  }
  return null;
}

const byName = (a: { displayName: string }, b: { displayName: string }) => a.displayName.localeCompare(b.displayName);

/**
 * Tile subtitle for a connected provider: the account it holds, not the marketing
 * line. Several accounts show only the count. Naming one of them read as "the"
 * account, and it was rarely the one just connected.
 */
function connectedSubtitle(p: ProviderStatus, conns: Connection[]): string {
  if (conns.length > 1) return `${conns.length} accounts connected`;
  const who = conns.map(connectionIdentity).find((w) => w && w !== p.displayName);
  return who ?? integrationMeta(p.id).description;
}

export function IntegrationsSection({ active = true, navigation }: {
  active?: boolean;
  /** Apps can reuse account setup without opening or changing Settings. */
  navigation?: { providerId: string; returnTo?: string; onBack: () => void };
}) {
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
  const [pendingRegisteredOAuth, setPendingRegisteredOAuth] = useState<{ id: string; displayName: string; serverId?: string; authorizationId?: string } | null>(null);
  const [query, setQuery] = useState('');

  const [view, setView] = useState<View>(() => navigation ? { kind: 'provider', id: navigation.providerId } : CATALOG);
  const [advancedOpen, setAdvancedOpen] = useState(false); // detail view's "Use your own OAuth app"
  const rootRef = useRef<HTMLDivElement>(null);
  const catalogScroll = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearch = useRef(false);

  const [creds, setCreds] = useState<Record<string, Record<string, string>>>({});
  const [endpointSelections, setEndpointSelections] = useState<Record<string, HostedEndpointSelection>>({});
  const [serviceSel, setServiceSel] = useState<Record<string, string[]>>({}); // providerId → selected toolkit ids at connect (§5)
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // BYO OAuth app state (per provider).
  const [byoConfigs, setByoConfigs] = useState<Record<string, AuthConfigSummary[]>>({});
  const [byoForm, setByoForm] = useState<Record<string, ByoForm>>({});

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
      trpcClient.integrations.statusGet.query({}),
      trpcClient.integrations.connectionsGet.query({}),
      trpcClient.integrations.toolkitsGet.query({}),
      trpcClient.integrations.writePolicyGet.query({}),
    ]);
    setProviders(st.providers);
    setRedirectUri(st.redirectUri);
    setConnections(cn.connections);
    setToolkits(tk.toolkits);
    const wpMap: Record<string, WritePolicyAction> = {};
    for (const t of wp.toolkits) for (const a of t.actions) wpMap[a.id] = { mode: a.mode, defaultMode: a.defaultMode, overridden: a.overridden };
    setWritePolicy(wpMap);
    return st.providers;
  }, []);

  useEffect(() => {
    if (!pendingRegisteredOAuth) return;
    return watchOAuthReturn(window, async () => {
      const current = await refresh();
      const provider = current.find(candidate => candidate.id === pendingRegisteredOAuth.id);
      return hostedAccountSignedIn(provider, pendingRegisteredOAuth.serverId, pendingRegisteredOAuth.authorizationId);
    }, () => {
      setBanner(`Connected ${pendingRegisteredOAuth.displayName}`);
      setPendingRegisteredOAuth(null);
    }, error => setError(errMsg(error)));
  }, [pendingRegisteredOAuth, refresh]);

  // Read the post-OAuth result the callback bounced back with, then strip it
  // from the URL (keep ?settings=plugins so the modal stays put).
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
      if (!navigation) setSettingsAnchor(next.kind === 'provider' ? `integrations:${next.id}` : 'integrations');
      setAdvancedOpen(false);
      setError(null);
      setBanner(null);
    },
    [view.kind, navigation],
  );
  const back = useCallback(() => navigation ? navigation.onBack() : navigate(CATALOG), [navigate, navigation]);

  // A detail opens at its top; the catalog comes back where it was left.
  useLayoutEffect(() => {
    if (!active) return;
    const pane = scrollParent(rootRef.current);
    if (pane) pane.scrollTop = view.kind === 'catalog' ? catalogScroll.current : 0;
    if (!isLoading && view.kind === 'catalog' && focusSearch.current) { searchRef.current?.focus(); focusSearch.current = false; }
  }, [active, isLoading, view]);

  // Esc inside a detail steps back to the catalog instead of closing Settings.
  // This window-level capture listener runs before Radix's document-level one,
  // and Radix skips its dismiss when the event is already default-prevented.
  useEffect(() => {
    if (!active || view.kind === 'catalog') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || !matchesHotkey(e, HOTKEYS.slideoutBack)) return;
      e.preventDefault();
      back();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, view.kind, back]);

  const reviewCapabilities = (serverId: string, reviewedRevision: string) => run(async () => {
    try {
      await trpcClient.integrations.mcpServersPatch.mutate({params: {id: serverId}, body: { reviewedRevision }});
    } catch (error) {
      // A newer discovery may have landed while this review was open. Keep its
      // latest changes visible and preserve the stale-review error.
      await refresh().catch(() => {});
      throw error;
    }
  });
  // Flip a mutating action between running on standing intent ('auto') and pausing
  // for a per-call approval ('ask'). The switch updates immediately.
  // Landing back on the default clears the override instead of pinning it, so
  // the "changed" marker only ever means "differs from the default".
  const setActionApproval = (actionId: string, mode: ApprovalMode) => {
    const prev = writePolicy[actionId];
    if (!prev) return;
    const override = mode === prev.defaultMode ? null : mode;
    setWritePolicy((wp) => ({ ...wp, [actionId]: { ...prev, mode, overridden: override !== null } }));
    trpcClient.integrations.writePolicyPost.mutate({body: { actionId, mode: override }}).catch((e) => {
      setWritePolicy((wp) => ({ ...wp, [actionId]: prev }));
      setError(errMsg(e));
    });
  };

  // --- Bring-your-own OAuth app -------------------------------------------

  const loadByo = useCallback(async (providerId: string) => {
    const { configs } = await trpcClient.integrations.authConfigsGet.query({query: rpcQuery({"providerId": providerId})});
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
      const callback = oauthAppRedirectUri(p, redirectUri);
      if (!callback) throw new Error('The callback address is unavailable. Reload Settings and try again.');
      await trpcClient.integrations.authConfigsPost.mutate({body: {
        providerId: p.id,
        label: form.label,
        oauth: { clientId: form.clientId, redirectUri: callback },
        clientSecret: form.clientSecret || undefined,
      }});
      setByoForm((f) => ({ ...f, [p.id]: EMPTY_BYO_FORM }));
      await loadByo(p.id);
      setBanner(`Added your ${p.displayName} app`);
    });

  const deleteByo = (p: ProviderStatus, id: string) =>
    run(async () => {
      await trpcClient.integrations.authConfigsDelete.mutate({query: rpcQuery({"id": id})});
      await loadByo(p.id);
    });

  const setDefaultByo = (p: ProviderStatus, id: string) =>
    run(async () => {
      await trpcClient.integrations.authConfigsDefaultPost.mutate({body: { providerId: p.id, id }});
      await loadByo(p.id);
    });

  const copyRedirect = () => {
    const provider = view.kind === 'provider' ? providers.find(p => p.id === view.id) : undefined;
    const callback = provider ? oauthAppRedirectUri(provider, redirectUri) : redirectUri;
    if (!callback) return;
    void navigator.clipboard?.writeText(callback).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  // --- Connect flows -------------------------------------------------------

  const authorize = useCallback(async (url: string, flowId?: string) => {
    if (flowId) setPendingOAuth(flowId);
    try { await openIntegrationAuthorization(url); }
    catch (error) {
      if (flowId) await trpcClient.desktop.cancelOAuth.mutate({ body: { id: flowId } }).catch(() => {});
      setPendingOAuth(null);
      throw error;
    }
  }, []);

  const openProvider = (p: ProviderStatus) => {
    navigate({ kind: 'provider', id: p.id });
    // OAuth details show the bring-your-own apps, so have them ready on arrival.
    if ((p.method === 'oauth2' || isRegisteredMcp(p)) && !p.orphan) loadByo(p.id).catch(() => {});
  };

  // `openSettings('plugins', { anchor: 'integrations:<id>' })` lands on that
  // provider's page (the main chat's first run links each app here). Once per
  // anchor, after the catalog has loaded, so Back still reaches the catalog.
  const { anchor, requestId } = useSettingsStore();
  const appProviderId = navigation?.providerId;
  const openedRequest = useRef<number | null>(null);
  useEffect(() => {
    if (navigation || !active || isLoading || openedRequest.current === requestId) return;
    openedRequest.current = requestId;
    if (anchor === PLUGIN_CREATE_ANCHORS.connectService) {
      catalogScroll.current = 0;
      const pane = scrollParent(rootRef.current);
      if (pane) pane.scrollTop = 0;
      focusSearch.current = true; setQuery(''); back();
      if (view.kind === 'catalog') { searchRef.current?.focus({ preventScroll: true }); focusSearch.current = false; }
      return;
    }
    if (anchor === 'integrations' || !anchor) { back(); return; }
    if (!anchor.startsWith('integrations:')) return;
    const provider = providers.find((p) => p.id === anchor.slice('integrations:'.length));
    if (provider) openProvider(provider);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on the anchor and the catalog, not on every handler identity
  }, [active, anchor, requestId, isLoading, providers, navigation]);

  useEffect(() => {
    if (!appProviderId) return;
    setView({ kind: 'provider', id: appProviderId });
    const provider = providers.find(item => item.id === appProviderId);
    if (provider && (provider.method === 'oauth2' || isRegisteredMcp(provider)) && !provider.orphan) {
      void loadByo(provider.id).catch(error => setError(errMsg(error)));
    }
  }, [appProviderId, providers, loadByo]);

  const connectOAuth = useCallback(
    async (p: ProviderStatus, authConfigId?: string, intent?: HostedConnectIntent) => {
      setBusy(true);
      setError(null);
      try {
        const result = await trpcClient.integrations.connectPost.mutate({body: {
          providerId: p.id,
          ...(navigation?.returnTo ? { returnTo: navigation.returnTo } : {}),
          ...(p.method === 'mcp' ? hostedAccountRequestFields(p, intent, authConfigId, endpointSelections[p.id], connections) : {
            label: p.displayName,
            scopes: connectScopes(p),
            ...(authConfigId ? { authConfigId } : {}),
          }),
        }});
        if (p.mcp?.accounts || p.mcp?.endpointConfig || isRegisteredMcp(p)) await refresh();
        const authorizationUrl = result.authorizationUrl ?? ('authUrl' in result ? result.authUrl : undefined);
        if (authorizationUrl) {
          if (isRegisteredMcp(p)) setPendingRegisteredOAuth({ id: p.id, displayName: intent?.label || p.displayName, serverId: ('serverId' in result ? result.serverId : undefined) ?? intent?.serverId, authorizationId: ('authorizationId' in result ? result.authorizationId : undefined) });
          await authorize(authorizationUrl, ('desktopFlowId' in result ? result.desktopFlowId : undefined));
          if (('desktopFlowId' in result ? result.desktopFlowId : undefined) || isRegisteredMcp(p)) setBusy(false);
        } else if (p.method === 'mcp' && ('requiresAuth' in result ? result.requiresAuth : undefined) === false) {
          await refresh();
          setBanner(`Connected ${p.displayName}`);
          setBusy(false);
        } else {
          throw new Error(`${p.displayName} did not provide a sign-in link. Try connecting again.`);
        }
      } catch (e) {
        if (isRegisteredMcp(p)) setPendingRegisteredOAuth(null);
        // Discovery can fail after the endpoint has been saved. Show its locked
        // state and Cancel setup without hiding the original connection error.
        if (p.mcp?.accounts || p.mcp?.endpointConfig || isRegisteredMcp(p)) await refresh().catch(() => {});
        // Multi-client provider with no default → open Advanced so the user picks one.
        if ((p.method === 'oauth2' || isRegisteredMcp(p)) && (e as { body?: { error?: string } }).body?.error === 'auth_config_required') {
          setAdvancedOpen(true);
          await loadByo(p.id).catch(() => {});
          setError(`This provider has more than one OAuth app. Pick one under ${isRegisteredMcp(p) ? 'OAuth apps' : 'Use your own OAuth app'} to connect.`);
        } else {
          setError(errMsg(e));
        }
        setBusy(false);
      }
    },
    [connectScopes, loadByo, authorize, refresh, endpointSelections, connections, navigation],
  );

  const connectDirect = (p: ProviderStatus, intent?: HostedConnectIntent) =>
    run(async () => {
      try {
        const { connection } = await trpcClient.integrations.connectDirectPost.mutate({body: {
          providerId: p.id, fields: intent?.fields ?? creds[p.id] ?? {},
          ...(p.method === 'mcp' ? hostedAccountRequestFields(p, intent, undefined, endpointSelections[p.id], connections) : { label: p.displayName }),
        }});
        setCreds((c) => ({ ...c, [p.id]: {} }));
        // Show the identity the engine discovered (identify()) so the connect lands with confidence.
        const who = connection?.email || (p.method === 'mcp' && connection?.accountId === `${p.id}:default` ? undefined : connection?.accountId);
        setBanner(who ? `Connected ${p.displayName} as ${who}` : `Connected ${p.displayName}`);
      } catch (error) {
        if (p.mcp?.accounts) await refresh().catch(() => {});
        throw error;
      }
    });

  const disconnect = (c: Connection) =>
    run(async () => {
      await trpcClient.integrations.disconnectPost.mutate({body: { id: c.id }});
      const account = providers.find(provider => provider.id === c.providerId)?.mcp?.accounts?.find(candidate => candidate.connectionId === c.id);
      setPendingRegisteredOAuth(pending => pending?.id === c.providerId && (!pending.serverId || pending.serverId === account?.serverId) ? null : pending);
      setEndpointSelections(previous => ({ ...previous, [c.providerId]: {} }));
      setBanner(`Disconnected ${connectionIdentity(c)}`);
    });

  const cancelSetup = (p: ProviderStatus, serverId = p.mcp?.serverId) => run(async () => {
    if (!serverId) return;
    await trpcClient.integrations.mcpServersDelete.mutate({params: {id: serverId}});
    setPendingRegisteredOAuth(pending => pending?.id === p.id && (!pending.serverId || pending.serverId === serverId) ? null : pending);
    setEndpointSelections(previous => ({ ...previous, [p.id]: {} }));
    setBanner(`Cancelled ${p.displayName} setup`);
  });

  const testConnection = async (id: string) => {
    setTesting(id);
    try {
      const res = await trpcClient.integrations.testPost.mutate({body: { id }});
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
      .filter((id) => !known.has(id) && (appProviderId === id || (id !== 'jira' && id !== 'confluence')))
      .map((id) => ({ id, displayName: id, method: 'custom', configured: false, credentialFields: [], orphan: true }));
    return [...providers, ...orphans];
  }, [providers, connectionsByProvider, appProviderId]);

  const q = query.trim().toLowerCase();
  const catalog = useMemo(() => {
    const matches = (p: ProviderStatus) => {
      if (!q) return true;
      const meta = integrationMeta(p.id);
      return (
        p.displayName.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        meta.description.toLowerCase().includes(q) ||
        meta.category.toLowerCase().includes(q)
      );
    };
    const visible = catalogProviders.filter(matches);
    const connected = visible.filter((p) => connectionsByProvider.has(p.id)).sort(byName);
    const groups: { category: IntegrationCategory; items: ProviderStatus[] }[] = [];
    for (const category of CATEGORY_ORDER) {
      const items = visible
        .filter((p) => !connectionsByProvider.has(p.id) && integrationMeta(p.id).category === category)
        .sort(byName);
      if (items.length) groups.push({ category, items });
    }
    const previous = connections.filter(c => (c.providerId === 'jira' || c.providerId === 'confluence') &&
      (!q || `${c.providerId} ${connectionIdentity(c)} Atlassian`.toLowerCase().includes(q)));
    const total = connected.length + groups.reduce((n, g) => n + g.items.length, 0) + previous.length;
    return { connected, groups, previous, total };
  }, [q, catalogProviders, connectionsByProvider, connections]);

  const selectedProvider = view.kind === 'provider' ? catalogProviders.find((p) => p.id === view.id) : undefined;
  // The selected provider vanished: fall back to the catalog rather than render an empty detail.
  const stale = !isLoading && view.kind === 'provider' && !selectedProvider;
  if (stale && !navigation) setView(CATALOG);

  if (isLoading) {
    return <SettingsSkeleton rows={5} />;
  }

  if (stale && navigation) return <div role="alert" className="space-y-3 text-sm"><p>{error ?? 'This service is no longer available.'}</p><Button variant="outline" onClick={back}>Back to library</Button></div>;

  const onCatalog = view.kind === 'catalog' || stale;

  return (
    <div ref={rootRef} className="@container space-y-6">
      {pendingOAuth && (
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
          <span>Finish connecting in your browser.</span>
          <Button variant="outline" size="sm" onClick={() => void run(async () => {
            await trpcClient.desktop.cancelOAuth.mutate({ body: { id: pendingOAuth } });
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
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${INTEGRATION_LABELS.plural.toLowerCase()}`}
              aria-label={`Search ${INTEGRATION_LABELS.plural.toLowerCase()}`}
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
              <h3 className="text-xs font-semibold text-foreground">No {INTEGRATION_LABELS.plural.toLowerCase()} match “{query}”</h3>
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
                      const healthy = conns.every((c) => c.status === 'active') && !p.mcp?.requiresAuth && (!p.mcp?.status || p.mcp.status === 'ok');
                      return (
                        <CatalogTile
                          key={p.id}
                          logo={<IntegrationLogo providerId={p.id} name={p.displayName} size={36} />}
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

              {catalog.previous.length > 0 && <PreviousConnections connections={catalog.previous} busy={busy} onDisconnect={disconnect} />}

              {catalog.groups.map(({ category, items }) => (
                <section key={category} className="space-y-2">
                  <GroupHeading>{category}</GroupHeading>
                  <TileGrid>
                    {items.map((p) => (
                      <CatalogTile
                        key={p.id}
                        logo={<IntegrationLogo providerId={p.id} name={p.displayName} size={36} />}
                        name={p.displayName}
                        subtitle={integrationMeta(p.id).description}
                        onOpen={() => openProvider(p)}
                      />
                    ))}
                  </TileGrid>
                </section>
              ))}
            </div>
          )}
        </>
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
          endpointSelection={endpointSelections[selectedProvider.id]}
          onEndpointChange={selection => setEndpointSelections(previous => ({ ...previous, [selectedProvider.id]: selection }))}
          onCancelSetup={serverId => cancelSetup(selectedProvider, serverId)}
          onReviewCapabilities={reviewCapabilities}
          selectedServices={
            serviceSel[selectedProvider.id] ?? providerToolkits(selectedProvider.id).map((t) => t.id)
          }
          advancedOpen={advancedOpen}
          redirectUri={redirectUri}
          copied={copied}
          byoConfigs={byoConfigs[selectedProvider.id] ?? []}
          byoForm={byoForm[selectedProvider.id] ?? EMPTY_BYO_FORM}
          onBack={back}
          onConnectOAuth={(authConfigId, intent) => connectOAuth(selectedProvider, authConfigId, intent)}
          onConnectDirect={intent => connectDirect(selectedProvider, intent)}
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

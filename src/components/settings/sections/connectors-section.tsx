'use client';

/**
 * Connectors settings pane — connect external services so agents can act on your
 * behalf. Browse the catalog (grouped by category, searchable), connect via the
 * right flow per provider (OAuth redirect, or paste-a-key for API-key/custom
 * providers), and manage connected accounts (test health, disconnect). OAuth
 * providers with no bundled client expose a "Bring your own app" panel under
 * Advanced; the client is stored sealed in your home, never in the repo.
 *
 * Single source of truth for connect mechanics is the engine API
 * (/connectors/status|connections|toolkits|connect|connectDirect|...). This pane
 * only adds presentation: logos (connector-logo.tsx) and grouping/copy
 * (connector-meta.ts). Replaces the former dev-only /connectors-test route.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search, Plug, Loader2, AlertCircle, CheckCircle2, Trash2, Plus, ChevronDown, ShieldCheck, ExternalLink, Copy, Check, Server,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ConnectorLogo } from '@/components/connectors/connector-logo';
import { connectorMeta, CATEGORY_ORDER, type ConnectorCategory } from '@/components/connectors/connector-meta';
import { SettingsSkeleton } from '@/components/settings/settings-skeleton';

interface ProviderStatus {
  id: string;
  displayName: string;
  method: 'oauth2' | 'api_key' | 'custom';
  configured: boolean;
  credentialFields?: string[];
}
interface Connection {
  id: string;
  providerId: string;
  accountId: string;
  email?: string | null;
  label?: string | null;
  scopes: string[];
  status: string;
}
interface ActionInfo {
  id: string;
  description: string;
  mutating: boolean;
  risk: string;
  scopes: string[];
}
interface ToolkitInfo {
  id: string;
  displayName: string;
  providerId: string;
  scopes: string[];
  actions: ActionInfo[];
}
type ApprovalMode = 'auto' | 'ask';
interface WritePolicyAction {
  mode: ApprovalMode;
  defaultMode: ApprovalMode;
  overridden: boolean;
}
interface AuthConfigSummary {
  id: string;
  providerId: string;
  label?: string;
  isDefault: boolean;
  status: string;
}
interface ByoForm {
  label: string;
  clientId: string;
  clientSecret: string;
}
interface McpToolOverride {
  enabled?: boolean;
  mutating?: boolean;
}
interface McpServerEntry {
  id: string;
  slug: string;
  displayName: string;
  url: string;
  enabled: boolean;
  auth: { kind: 'none' } | { kind: 'bearer' } | { kind: 'header'; header: string } | { kind: 'oauth' };
  tools?: { name: string; description?: string }[];
  toolOverrides?: Record<string, McpToolOverride>;
  lastStatus?: 'ok' | 'unreachable' | 'error';
  lastError?: string;
  lastToolCount?: number;
  lastCheckedAt?: string;
}
interface McpForm {
  name: string;
  url: string;
  authKind: 'none' | 'bearer' | 'header' | 'oauth';
  header: string;
  secret: string;
}
const EMPTY_MCP_FORM: McpForm = { name: '', url: '', authKind: 'none', header: '', secret: '' };

/** Prefer the API error body's reason ("API 400 …" hides it) so failures read clearly. */
function errMsg(e: unknown): string {
  const body = (e as { body?: { error?: string } }).body;
  if (body?.error) return body.error;
  return e instanceof Error ? e.message : String(e);
}

/** "client_id" → "Client ID", "api_token" → "Api Token". */
function prettyField(field: string): string {
  return field
    .split(/[_\s]+/)
    .map((w) => (w.toLowerCase() === 'id' ? 'ID' : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

const SECRETY = /(secret|token|key|password|pass)/i;

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
  const [query, setQuery] = useState('');

  const [expanded, setExpanded] = useState<string | null>(null); // providerId with its connect panel open
  const [toolsOpen, setToolsOpen] = useState<string | null>(null); // providerId whose tool list is expanded
  const [toolFilter, setToolFilter] = useState(''); // search within the open tool list
  const [creds, setCreds] = useState<Record<string, Record<string, string>>>({});
  const [serviceSel, setServiceSel] = useState<Record<string, string[]>>({}); // providerId → selected toolkit ids at connect (§5)
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; status: string; error?: string }>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // BYO OAuth app state (per provider).
  const [byoConfigs, setByoConfigs] = useState<Record<string, AuthConfigSummary[]>>({});
  const [byoForm, setByoForm] = useState<Record<string, ByoForm>>({});

  // MCP servers (ingest external MCP as connectors).
  const [mcpServers, setMcpServers] = useState<McpServerEntry[]>([]);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [mcpForm, setMcpForm] = useState<McpForm>(EMPTY_MCP_FORM);
  const [mcpToolsOpen, setMcpToolsOpen] = useState<string | null>(null); // server id whose tool list is expanded

  const providerById = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers]);

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
  const providerActionCount = useCallback(
    (providerId: string): number => providerToolkits(providerId).reduce((n, t) => n + t.actions.length, 0),
    [providerToolkits],
  );
  const toggleTools = useCallback((providerId: string) => {
    setToolFilter('');
    setToolsOpen((cur) => (cur === providerId ? null : providerId));
  }, []);
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
    if (connected) setBanner(`Connected ${connected}`);
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
      const r = await api.post<{ toolCount?: number; requiresAuth?: boolean; authUrl?: string }>(
        '/connectors/mcp-servers',
        { name: f.name.trim(), url: f.url.trim(), auth, ...(usesSecret ? { secret: f.secret } : {}) },
      );
      if (r.requiresAuth && r.authUrl) {
        window.location.href = r.authUrl; // redirect to sign in; we return via the OAuth callback
        return;
      }
      setBanner(
        `Added ${f.name.trim()}${typeof r.toolCount === 'number' ? ` (${r.toolCount} tool${r.toolCount === 1 ? '' : 's'})` : ''}`,
      );
      setMcpForm(EMPTY_MCP_FORM);
      setMcpOpen(false);
    });
  const authorizeMcp = (id: string) =>
    run(async () => {
      const r = await api.post<{ requiresAuth?: boolean; authUrl?: string }>(`/connectors/mcp-servers/${id}`, {});
      if (r.requiresAuth && r.authUrl) window.location.href = r.authUrl;
    });

  const removeMcp = (id: string) => run(() => api.delete(`/connectors/mcp-servers/${id}`).then(() => {}));
  const toggleMcp = (s: McpServerEntry) =>
    run(() => api.patch(`/connectors/mcp-servers/${s.id}`, { enabled: !s.enabled }).then(() => {}));
  const retestMcp = (id: string) =>
    run(async () => {
      await api.patch(`/connectors/mcp-servers/${id}`, {}); // invalidate
      await api.get('/connectors/connections'); // force a rebuild so health refreshes
    });
  const setMcpToolOverride = (s: McpServerEntry, toolName: string, patch: McpToolOverride) =>
    run(async () => {
      const current = s.toolOverrides ?? {};
      const toolOverrides = { ...current, [toolName]: { ...current[toolName], ...patch } };
      await api.patch(`/connectors/mcp-servers/${s.id}`, { toolOverrides });
    });

  // Flip a mutating action between running on standing intent ('auto') and pausing
  // for a per-call approval ('ask'). Persisted as a per-action override.
  const setActionApproval = (actionId: string, mode: ApprovalMode) =>
    run(async () => {
      await api.post('/connectors/write-policy', { actionId, mode });
    });

  // --- Connect flows -------------------------------------------------------

  const connectOAuth = useCallback(
    async (p: ProviderStatus, authConfigId?: string) => {
      setBusy(true);
      setError(null);
      try {
        const { authorizationUrl } = await api.post<{ authorizationUrl: string }>('/connectors/connect', {
          providerId: p.id,
          scopes: connectScopes(p),
          label: p.displayName,
          ...(authConfigId ? { authConfigId } : {}),
        });
        window.location.href = authorizationUrl; // leaves the app; callback returns us here
      } catch (e) {
        // Multi-client provider with no default → open Advanced so the user picks one.
        if ((e as { body?: { error?: string } }).body?.error === 'auth_config_required') {
          await openAdvanced(p);
          setError('This provider has multiple apps. Pick one below to connect.');
        } else {
          setError(errMsg(e));
        }
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connectScopes],
  );

  const connectDirect = (p: ProviderStatus) =>
    run(async () => {
      const { connection } = await api.post<{
        connection?: { email?: string | null; label?: string | null; accountId?: string };
      }>('/connectors/connectDirect', { providerId: p.id, fields: creds[p.id] ?? {}, label: p.displayName });
      setCreds((c) => ({ ...c, [p.id]: {} }));
      setExpanded(null);
      // Show the identity the engine discovered (identify()) so the connect lands with confidence.
      const who = connection?.email || connection?.accountId;
      setBanner(who ? `Connected ${p.displayName} as ${who}` : `Connected ${p.displayName}`);
    });

  const disconnect = (id: string) => run(() => api.post('/connectors/disconnect', { id }).then(() => {}));

  const testConnection = async (id: string) => {
    setTesting(id);
    try {
      const res = await api.post<{ ok: boolean; status: string; error?: string }>('/connectors/test', { id });
      setTestResults((prev) => ({ ...prev, [id]: res }));
      await refresh(); // the probe may have healed the stored status
    } catch (e) {
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, status: 'error', error: errMsg(e) } }));
    } finally {
      setTesting(null);
    }
  };

  // --- Bring-your-own OAuth app -------------------------------------------

  const loadByo = useCallback(async (providerId: string) => {
    const { configs } = await api.get<{ configs: AuthConfigSummary[] }>(
      `/connectors/auth-configs?providerId=${encodeURIComponent(providerId)}`,
    );
    setByoConfigs((c) => ({ ...c, [providerId]: configs }));
  }, []);

  const openAdvanced = useCallback(
    async (p: ProviderStatus) => {
      setExpanded((cur) => (cur === p.id ? null : p.id));
      setByoForm((f) => ({ ...f, [p.id]: f[p.id] ?? { label: '', clientId: '', clientSecret: '' } }));
      await loadByo(p.id).catch(() => {});
    },
    [loadByo],
  );

  const setByoField = (providerId: string, field: keyof ByoForm, value: string) =>
    setByoForm((f) => ({
      ...f,
      [providerId]: { ...(f[providerId] ?? { label: '', clientId: '', clientSecret: '' }), [field]: value },
    }));

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
        oauth: { clientId: form.clientId, redirectUri },
        clientSecret: form.clientSecret || undefined,
      });
      setByoForm((f) => ({ ...f, [p.id]: { label: '', clientId: '', clientSecret: '' } }));
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

  // --- Derived view --------------------------------------------------------

  const matches = useCallback(
    (p: ProviderStatus): boolean => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      const meta = connectorMeta(p.id);
      return (
        p.displayName.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        meta.description.toLowerCase().includes(q) ||
        meta.category.toLowerCase().includes(q)
      );
    },
    [query],
  );

  const connectionsByProvider = useMemo(() => {
    const m = new Map<string, Connection[]>();
    for (const c of connections) m.set(c.providerId, [...(m.get(c.providerId) ?? []), c]);
    return m;
  }, [connections]);

  const grouped = useMemo(() => {
    const out: { category: ConnectorCategory; items: ProviderStatus[] }[] = [];
    for (const category of CATEGORY_ORDER) {
      const items = providers
        .filter((p) => connectorMeta(p.id).category === category && matches(p))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      if (items.length) out.push({ category, items });
    }
    return out;
  }, [providers, matches]);

  const totalMatches = grouped.reduce((n, g) => n + g.items.length, 0);

  const copyRedirect = () => {
    void navigator.clipboard?.writeText(redirectUri).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (isLoading) {
    return <SettingsSkeleton rows={5} />;
  }

  return (
    <div className="space-y-6">
      {busy && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 size={12} className="animate-spin" /> Working…
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

      {/* Connected accounts */}
      {connections.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Connected</h2>
            <Badge variant="secondary" className="rounded-full text-xs">
              {connections.length} {connections.length === 1 ? 'account' : 'accounts'}
            </Badge>
          </div>
          <div className="space-y-2">
            {connections.map((c) => {
              const p = providerById.get(c.providerId);
              const name = p?.displayName ?? c.providerId;
              const title = c.email || c.label || c.accountId;
              const tr = testResults[c.id];
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card/30 p-3"
                >
                  <ConnectorLogo providerId={c.providerId} name={name} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{title}</span>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                          c.status === 'active'
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
                        )}
                      >
                        {c.status}
                      </span>
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {name}
                      {c.scopes.length > 0 && ` · ${c.scopes.length} scope${c.scopes.length === 1 ? '' : 's'}`}
                      {tr && (
                        <span className={tr.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}>
                          {' '}
                          · {tr.ok ? '✓ healthy' : `✗ ${tr.error || tr.status}`}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => testConnection(c.id)}
                      disabled={busy || testing === c.id}
                      className="text-xs"
                    >
                      {testing === c.id ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
                      Test
                    </Button>
                    <Button
                      variant="destructive"
                      size="xs"
                      onClick={() => disconnect(c.id)}
                      disabled={busy}
                      className="text-xs"
                    >
                      <Trash2 size={12} /> Disconnect
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Search */}
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
          className="rounded-4xl pl-9 text-xs"
        />
      </div>

      {/* Catalog */}
      {totalMatches === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/10 p-8 text-center">
          <div className="mb-3 rounded-full bg-muted/60 p-3 text-muted-foreground">
            <Plug size={22} />
          </div>
          <h3 className="text-xs font-semibold text-foreground">No connectors match “{query}”</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">Try a different name or category.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ category, items }) => (
            <section key={category} className="space-y-2">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{category}</h3>
              <div className="space-y-2">
                {items.map((p) => {
                  const conns = connectionsByProvider.get(p.id) ?? [];
                  const meta = connectorMeta(p.id);
                  const isOpen = expanded === p.id;
                  const isOAuth = p.method === 'oauth2';
                  const fields = p.credentialFields ?? ['apiKey'];
                  const filled = !isOAuth && fields.every((f) => (creds[p.id]?.[f] ?? '').trim().length > 0);

                  return (
                    <div key={p.id} className="rounded-xl border border-border bg-card/20">
                      <div className="flex items-center gap-3 p-3">
                        <ConnectorLogo providerId={p.id} name={p.displayName} size={36} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground">{p.displayName}</span>
                            {conns.length > 0 && (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 size={9} /> {conns.length > 1 ? `${conns.length} connected` : 'Connected'}
                              </span>
                            )}
                          </div>
                          {meta.description && (
                            <p className="truncate text-[11px] text-muted-foreground">{meta.description}</p>
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          {providerActionCount(p.id) > 0 && (
                            <Button
                              variant="ghost"
                              size="xs"
                              aria-expanded={toolsOpen === p.id}
                              onClick={() => toggleTools(p.id)}
                              disabled={busy}
                              title="See the tools agents can call with this connector"
                              className="text-xs"
                            >
                              Tools
                              <ChevronDown
                                size={12}
                                className={cn('transition-transform', toolsOpen === p.id && 'rotate-180')}
                              />
                            </Button>
                          )}
                          {isOAuth ? (
                            p.configured ? (
                              <>
                                <Button
                                  size="xs"
                                  onClick={() => connectOAuth(p)}
                                  disabled={busy}
                                  className="text-xs font-semibold"
                                >
                                  {conns.length > 0 ? 'Add account' : 'Connect'}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  aria-expanded={isOpen}
                                  onClick={() => openAdvanced(p)}
                                  disabled={busy}
                                  title="Advanced: bring your own OAuth app"
                                >
                                  <ChevronDown
                                    size={14}
                                    className={cn('transition-transform', isOpen && 'rotate-180')}
                                  />
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="outline"
                                size="xs"
                                aria-expanded={isOpen}
                                onClick={() => openAdvanced(p)}
                                disabled={busy}
                                className="text-xs font-semibold"
                              >
                                Set up
                                <ChevronDown size={12} className={cn('transition-transform', isOpen && 'rotate-180')} />
                              </Button>
                            )
                          ) : (
                            <Button
                              variant={isOpen ? 'secondary' : 'default'}
                              size="xs"
                              aria-expanded={isOpen}
                              onClick={() => setExpanded((cur) => (cur === p.id ? null : p.id))}
                              disabled={busy}
                              className="text-xs font-semibold"
                            >
                              {conns.length > 0 ? 'Add account' : 'Connect'}
                              <ChevronDown size={12} className={cn('transition-transform', isOpen && 'rotate-180')} />
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Tool list — what agents can call with this connector (read-only preview) */}
                      {toolsOpen === p.id && (() => {
                        const tks = providerToolkits(p.id);
                        const q = toolFilter.trim().toLowerCase();
                        const match = (a: ActionInfo) =>
                          !q || a.id.toLowerCase().includes(q) || a.description.toLowerCase().includes(q);
                        const total = tks.reduce((n, t) => n + t.actions.length, 0);
                        const shown = tks.reduce((n, t) => n + t.actions.filter(match).length, 0);
                        return (
                          <div className="space-y-2 border-t border-border/50 px-3 pb-3 pt-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Tools agents can call ({total})
                              </span>
                              <input
                                value={toolFilter}
                                onChange={(e) => setToolFilter(e.target.value)}
                                placeholder="Filter tools…"
                                className="h-7 w-40 rounded-lg border border-border bg-input/30 px-2 text-[11px] text-foreground"
                              />
                            </div>
                            <p className="text-[10px] leading-normal text-muted-foreground">
                              Available to the orchestrator and to executions scoped to this service.{' '}
                              <span className="font-semibold">Read</span> is safe. Reversible{' '}
                              <span className="font-semibold">Write</span> actions run once connected; sends, posts, and
                              deletes stay behind <span className="font-semibold">Ask</span> approval. Toggle Ask to change any
                              action (<span className="font-semibold">*</span> = changed from default).
                            </p>
                            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                              {tks.map((t) => {
                                const acts = t.actions.filter(match);
                                if (acts.length === 0) return null;
                                return (
                                  <div key={t.id} className="space-y-1">
                                    {tks.length > 1 && (
                                      <div className="px-1 text-[10px] font-semibold text-foreground/70">{t.displayName}</div>
                                    )}
                                    {acts.map((a) => (
                                      <div key={a.id} className="flex items-start gap-2 rounded-lg px-1 py-1 hover:bg-muted/30">
                                        <span
                                          className={cn(
                                            'mt-0.5 shrink-0 rounded px-1 py-0.5 text-[8px] font-semibold uppercase',
                                            a.mutating
                                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                              : 'bg-muted text-muted-foreground',
                                          )}
                                        >
                                          {a.mutating ? 'Write' : 'Read'}
                                        </span>
                                        <div className="min-w-0">
                                          <div className="truncate font-mono text-[11px] text-foreground" title={a.id}>
                                            {a.id}
                                          </div>
                                          {a.description && (
                                            <div className="truncate text-[10px] text-muted-foreground" title={a.description}>
                                              {a.description}
                                            </div>
                                          )}
                                        </div>
                                        {a.mutating &&
                                          (() => {
                                            const wp = writePolicy[a.id];
                                            const gated = wp ? wp.mode === 'ask' : true; // gated until policy loads
                                            return (
                                              <label
                                                className="ml-auto mt-0.5 flex shrink-0 cursor-pointer items-center gap-1 text-[10px] text-muted-foreground"
                                                title="Require your approval before this action runs"
                                              >
                                                <input
                                                  type="checkbox"
                                                  checked={gated}
                                                  disabled={busy}
                                                  onChange={() => setActionApproval(a.id, gated ? 'auto' : 'ask')}
                                                  aria-label={`Require approval for ${a.id}`}
                                                  className="size-3.5 cursor-pointer accent-primary"
                                                />
                                                <span>Ask{wp?.overridden ? '*' : ''}</span>
                                              </label>
                                            );
                                          })()}
                                      </div>
                                    ))}
                                  </div>
                                );
                              })}
                              {shown === 0 && (
                                <p className="px-1 text-[11px] text-muted-foreground">No tools match “{toolFilter}”.</p>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Expanded connect panel */}
                      {isOpen && (
                        <div className="space-y-3 border-t border-border/50 px-3 pb-3 pt-3">
                          {isOAuth ? (
                            <>
                              {providerToolkits(p.id).length > 1 && (
                                <div className="space-y-1.5 rounded-lg border border-border/50 bg-muted/30 p-2.5">
                                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Services to grant
                                  </div>
                                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                                    {providerToolkits(p.id).map((t) => {
                                      const sel = serviceSel[p.id];
                                      const on = sel ? sel.includes(t.id) : true;
                                      return (
                                        <label
                                          key={t.id}
                                          className="flex cursor-pointer items-center gap-2 text-[11px] text-foreground/90"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={on}
                                            disabled={busy}
                                            onChange={() => toggleService(p.id, t.id)}
                                            className="size-3.5 cursor-pointer rounded border-border accent-primary"
                                          />
                                          <span className="truncate">{t.displayName}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                  <p className="text-[10px] leading-normal text-muted-foreground">
                                    Only requests access to the services you check. You can grant more later.
                                  </p>
                                </div>
                              )}
                              <ByoPanel
                                provider={p}
                              redirectUri={redirectUri}
                              copied={copied}
                              onCopyRedirect={copyRedirect}
                              configs={byoConfigs[p.id] ?? []}
                              form={byoForm[p.id] ?? { label: '', clientId: '', clientSecret: '' }}
                              busy={busy}
                              onField={setByoField}
                              onAdd={() => addByo(p)}
                              onConnect={(id) => connectOAuth(p, id)}
                              onSetDefault={(id) => setDefaultByo(p, id)}
                              onDelete={(id) => deleteByo(p, id)}
                              />
                            </>
                          ) : (
                            <div className="space-y-3">
                              {(meta.setup?.length || meta.docsUrl) && (
                                <div className="space-y-2 rounded-lg border border-border/50 bg-muted/30 p-2.5">
                                  {meta.setup && meta.setup.length > 0 && (
                                    <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-normal text-muted-foreground">
                                      {meta.setup.map((step, i) => (
                                        <li key={i}>{step}</li>
                                      ))}
                                    </ol>
                                  )}
                                  {meta.docsUrl && (
                                    <a
                                      href={meta.docsUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                                    >
                                      Get your {p.displayName} {p.method === 'api_key' ? 'API key' : 'credentials'}
                                      <ExternalLink size={11} />
                                    </a>
                                  )}
                                </div>
                              )}
                              <p className="text-[11px] leading-normal text-muted-foreground">
                                Paste your {p.displayName} credential{fields.length > 1 ? 's' : ''}. Stored sealed in your
                                home (<code className="rounded bg-muted px-1">.config/connectors</code>), never in the
                                repo and never shown to the model.
                              </p>
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {fields.map((f) => (
                                  <div key={f} className="space-y-1">
                                    <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                      {prettyField(f)}
                                    </label>
                                    <Input
                                      type={SECRETY.test(f) ? 'password' : 'text'}
                                      autoComplete="off"
                                      value={creds[p.id]?.[f] ?? ''}
                                      onChange={(e) =>
                                        setCreds((c) => ({ ...c, [p.id]: { ...(c[p.id] ?? {}), [f]: e.target.value } }))
                                      }
                                      placeholder={prettyField(f)}
                                      className="h-8 rounded-lg font-mono text-xs"
                                    />
                                  </div>
                                ))}
                              </div>
                              <Button
                                size="sm"
                                onClick={() => connectDirect(p)}
                                disabled={busy || !filled}
                                className="text-xs font-semibold"
                              >
                                <Plus size={14} /> Connect {p.displayName}
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* MCP servers — ingest a remote MCP server's tools as gated connectors */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">MCP servers</h3>
            <p className="text-[11px] text-muted-foreground">
              Add a remote MCP server and its tools become connectors, behind your approval gate.
            </p>
          </div>
          <Button
            size="xs"
            variant={mcpOpen ? 'secondary' : 'outline'}
            aria-expanded={mcpOpen}
            onClick={() => setMcpOpen((v) => !v)}
            disabled={busy}
            className="shrink-0 text-xs font-semibold"
          >
            <Plus size={12} /> Add server
          </Button>
        </div>

        {mcpServers.length > 0 && (
          <div className="space-y-2">
            {mcpServers.map((s) => (
              <div key={s.id} className="rounded-xl border border-border bg-card/20 p-3">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      'rounded-xl bg-muted/50 p-2 text-muted-foreground ring-1 ring-inset ring-border/50',
                      !s.enabled && 'opacity-50',
                    )}
                  >
                    <Server size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{s.displayName}</span>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                          s.lastStatus === 'ok'
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : s.lastStatus === 'unreachable'
                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                              : s.lastStatus === 'error'
                                ? 'bg-destructive/10 text-destructive'
                                : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {s.lastStatus ?? 'pending'}
                      </span>
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {s.url}
                      {typeof s.lastToolCount === 'number' && ` · ${s.lastToolCount} tools`}
                    </p>
                    {s.lastStatus === 'unreachable' && s.lastError && (
                      <p className="truncate text-[10px] text-amber-600 dark:text-amber-400">{s.lastError}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {s.auth.kind === 'oauth' && s.lastStatus !== 'ok' && (
                      <Button size="xs" onClick={() => authorizeMcp(s.id)} disabled={busy} className="text-xs font-semibold">
                        Authorize
                      </Button>
                    )}
                    {(s.tools?.length ?? 0) > 0 && (
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-expanded={mcpToolsOpen === s.id}
                        onClick={() => setMcpToolsOpen((v) => (v === s.id ? null : s.id))}
                        disabled={busy}
                        className="text-xs"
                      >
                        Tools
                        <ChevronDown size={12} className={cn('transition-transform', mcpToolsOpen === s.id && 'rotate-180')} />
                      </Button>
                    )}
                    <Button variant="outline" size="xs" onClick={() => retestMcp(s.id)} disabled={busy} className="text-xs">
                      Re-test
                    </Button>
                    <Button
                      variant={s.enabled ? 'outline' : 'secondary'}
                      size="xs"
                      onClick={() => toggleMcp(s)}
                      disabled={busy}
                      className={cn(
                        'text-xs',
                        s.enabled &&
                          'border-emerald-500/20 bg-emerald-500/5 text-emerald-600 hover:bg-emerald-500/10 dark:border-emerald-400/20 dark:text-emerald-400',
                      )}
                    >
                      {s.enabled ? 'On' : 'Off'}
                    </Button>
                    <Button variant="destructive" size="icon-xs" onClick={() => removeMcp(s.id)} disabled={busy} title="Remove server">
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </div>

                {mcpToolsOpen === s.id && (s.tools?.length ?? 0) > 0 && (
                  <div className="mt-2.5 space-y-1 border-t border-border/40 pt-2.5">
                    <div className="grid grid-cols-[1fr_3rem_4rem] items-center gap-x-2 px-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <span>Tool</span>
                      <span className="text-center">On</span>
                      <span className="text-center">Approval</span>
                    </div>
                    {s.tools!.map((t) => {
                      const ov = s.toolOverrides?.[t.name];
                      const toolEnabled = ov?.enabled !== false;
                      const gated = ov?.mutating !== false;
                      return (
                        <div
                          key={t.name}
                          className="grid grid-cols-[1fr_3rem_4rem] items-center gap-x-2 rounded-lg px-1 py-1 hover:bg-muted/30"
                        >
                          <span className="truncate font-mono text-[11px] text-foreground" title={t.description ?? t.name}>
                            {t.name}
                          </span>
                          <input
                            type="checkbox"
                            checked={toolEnabled}
                            disabled={busy}
                            onChange={() => setMcpToolOverride(s, t.name, { enabled: !toolEnabled })}
                            aria-label={`Enable ${t.name}`}
                            className="size-3.5 cursor-pointer justify-self-center accent-primary"
                          />
                          <input
                            type="checkbox"
                            checked={gated}
                            disabled={busy || !toolEnabled}
                            onChange={() => setMcpToolOverride(s, t.name, { mutating: !gated })}
                            aria-label={`Require approval for ${t.name}`}
                            title="Require your approval before this tool runs"
                            className="size-3.5 cursor-pointer justify-self-center accent-primary disabled:opacity-40"
                          />
                        </div>
                      );
                    })}
                    <p className="px-1 pt-1 text-[10px] leading-normal text-muted-foreground">
                      Uncheck <span className="font-medium">Approval</span> only for trusted read-only tools. Restart a
                      running agent session to pick up changes.
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {mcpOpen && (
          <div className="space-y-3 rounded-xl border border-border bg-card/20 p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input
                value={mcpForm.name}
                onChange={(e) => setMcpForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Name (e.g. Sentry)"
                className="h-8 rounded-lg text-xs"
              />
              <Input
                value={mcpForm.url}
                onChange={(e) => setMcpForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://mcp.example.com"
                className="h-8 rounded-lg font-mono text-xs"
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Auth</label>
                <select
                  value={mcpForm.authKind}
                  onChange={(e) => setMcpForm((f) => ({ ...f, authKind: e.target.value as McpForm['authKind'] }))}
                  className="h-8 w-full rounded-lg border border-border bg-input/30 px-2 text-xs text-foreground"
                >
                  <option value="none">None</option>
                  <option value="bearer">Bearer token</option>
                  <option value="header">Custom header</option>
                  <option value="oauth">OAuth (sign in)</option>
                </select>
              </div>
              {mcpForm.authKind === 'header' && (
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Header name</label>
                  <Input
                    value={mcpForm.header}
                    onChange={(e) => setMcpForm((f) => ({ ...f, header: e.target.value }))}
                    placeholder="X-API-Key"
                    className="h-8 rounded-lg font-mono text-xs"
                  />
                </div>
              )}
            </div>
            {(mcpForm.authKind === 'bearer' || mcpForm.authKind === 'header') && (
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Secret</label>
                <Input
                  type="password"
                  autoComplete="off"
                  value={mcpForm.secret}
                  onChange={(e) => setMcpForm((f) => ({ ...f, secret: e.target.value }))}
                  placeholder="Token / key"
                  className="h-8 rounded-lg font-mono text-xs"
                />
              </div>
            )}
            {mcpForm.authKind === 'oauth' && (
              <p className="rounded-lg border border-border/50 bg-muted/30 p-2.5 text-[11px] leading-normal text-muted-foreground">
                You&apos;ll be redirected to sign in. We register a client automatically (no secret to paste) and store
                the tokens sealed in your home, refreshed for you.
              </p>
            )}
            <p className="text-[11px] leading-normal text-muted-foreground">
              Its tools run behind your approval gate, like every connector. The secret is sealed in your home and never
              shown to the model. If an agent session is already running, restart it to use newly added tools.
            </p>
            <Button
              size="sm"
              onClick={addMcp}
              disabled={
                busy ||
                !mcpForm.name.trim() ||
                !mcpForm.url.trim() ||
                ((mcpForm.authKind === 'bearer' || mcpForm.authKind === 'header') && !mcpForm.secret) ||
                (mcpForm.authKind === 'header' && !mcpForm.header.trim())
              }
              className="text-xs font-semibold"
            >
              <Plus size={14} /> {mcpForm.authKind === 'oauth' ? 'Add and sign in' : 'Add and connect'}
            </Button>
          </div>
        )}

        {mcpServers.length === 0 && !mcpOpen && <p className="text-[11px] text-muted-foreground">No MCP servers yet.</p>}
      </section>
    </div>
  );
}

/** Bring-your-own OAuth app panel (Advanced) for an OAuth provider. */
function ByoPanel({
  provider,
  redirectUri,
  copied,
  onCopyRedirect,
  configs,
  form,
  busy,
  onField,
  onAdd,
  onConnect,
  onSetDefault,
  onDelete,
}: {
  provider: ProviderStatus;
  redirectUri: string;
  copied: boolean;
  onCopyRedirect: () => void;
  configs: AuthConfigSummary[];
  form: ByoForm;
  busy: boolean;
  onField: (providerId: string, field: keyof ByoForm, value: string) => void;
  onAdd: () => void;
  onConnect: (authConfigId: string) => void;
  onSetDefault: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const docsUrl = connectorMeta(provider.id).docsUrl;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
        <ShieldCheck size={13} className="text-muted-foreground" />
        Bring your own OAuth app
      </div>
      <p className="text-[11px] leading-normal text-muted-foreground">
        Register an app with {provider.displayName}, add this redirect URI, then paste the client below. It is stored
        sealed in your home, never in the repo.
      </p>
      {docsUrl && (
        <a
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
        >
          Create an app on {provider.displayName}
          <ExternalLink size={11} />
        </a>
      )}

      {/* Redirect URI to register */}
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 p-2">
        <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{redirectUri}</code>
        <Button variant="ghost" size="icon-xs" onClick={onCopyRedirect} title="Copy redirect URI">
          {copied ? <Check size={12} className="text-emerald-600 dark:text-emerald-400" /> : <Copy size={12} />}
        </Button>
      </div>

      {/* Existing BYO clients */}
      {configs.length > 0 && (
        <div className="space-y-1.5">
          {configs.map((cfg) => (
            <div
              key={cfg.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/40 px-2.5 py-1.5 text-[11px]"
            >
              <span className="min-w-0 truncate text-foreground">
                {cfg.label ?? cfg.id}
                {cfg.isDefault && <span className="ml-1 text-muted-foreground">· default</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => onConnect(cfg.id)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 font-semibold text-primary hover:underline disabled:opacity-40"
                >
                  <ExternalLink size={11} /> Connect
                </button>
                {!cfg.isDefault && (
                  <button
                    onClick={() => onSetDefault(cfg.id)}
                    disabled={busy}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    Default
                  </button>
                )}
                <button
                  onClick={() => onDelete(cfg.id)}
                  disabled={busy}
                  className="text-destructive hover:underline disabled:opacity-40"
                >
                  Remove
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Add a client */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input
          value={form.label}
          onChange={(e) => onField(provider.id, 'label', e.target.value)}
          placeholder="Label (e.g. Work)"
          className="h-8 rounded-lg text-xs"
        />
        <Input
          value={form.clientId}
          onChange={(e) => onField(provider.id, 'clientId', e.target.value)}
          placeholder="Client ID"
          className="h-8 rounded-lg font-mono text-xs"
        />
        <Input
          type="password"
          autoComplete="off"
          value={form.clientSecret}
          onChange={(e) => onField(provider.id, 'clientSecret', e.target.value)}
          placeholder="Client secret (blank for PKCE)"
          className="h-8 rounded-lg font-mono text-xs sm:col-span-2"
        />
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onAdd}
        disabled={busy || !form.label.trim() || !form.clientId.trim()}
        className="text-xs font-semibold"
      >
        <Plus size={14} /> Add app
      </Button>
    </div>
  );
}

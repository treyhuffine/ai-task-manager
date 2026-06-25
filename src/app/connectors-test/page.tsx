'use client';

/**
 * Connections — manage external-account integrations. Connect accounts (OAuth redirect or
 * paste-a-key), see/disconnect connected accounts, run actions, and — under "Advanced" — bring
 * your own OAuth app per provider (stored sealed in the home, not repo env).
 *
 * Connect options per OAuth provider, in order of preference:
 *   1. A bundled/operator client (zero-config Connect) — if `configured`.
 *   2. Your own OAuth app (Advanced → Bring your own app) — persists in the home store.
 * API-key / custom providers connect by pasting a credential.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api/client';
import { LIVE_CHECKS } from '@/lib/connectors/live-checks';

interface LiveCheckResult {
  label: string;
  ok: boolean;
  detail: string;
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
interface Connection {
  id: string;
  providerId: string;
  accountId: string;
  email?: string;
  label?: string;
  scopes: string[];
  status: string;
}
interface ProviderStatus {
  id: string;
  displayName: string;
  method: 'oauth2' | 'api_key' | 'custom';
  configured: boolean;
  credentialFields?: string[];
}
interface Status {
  redirectUri: string;
  providers: ProviderStatus[];
}
interface AuthConfigSummary {
  id: string;
  providerId: string;
  scheme: string;
  label?: string;
  isDefault: boolean;
  status: string;
}
interface ByoForm {
  label: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export default function ConnectorsTestPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [toolkits, setToolkits] = useState<ToolkitInfo[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [creds, setCreds] = useState<Record<string, Record<string, string>>>({});
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; status: string; error?: string }>>({});
  const [testing, setTesting] = useState<string | null>(null); // connection id being probed
  const [liveResults, setLiveResults] = useState<Record<string, LiveCheckResult[]>>({});
  const [liveRunning, setLiveRunning] = useState<string | null>(null); // connection id running live checks
  const [advanced, setAdvanced] = useState<string | null>(null); // providerId whose BYO panel is open
  const [byoConfigs, setByoConfigs] = useState<Record<string, AuthConfigSummary[]>>({});
  const [byoForm, setByoForm] = useState<Record<string, ByoForm>>({});

  const [actionId, setActionId] = useState('');
  const [account, setAccount] = useState('');
  const [inputText, setInputText] = useState('{}');
  const [result, setResult] = useState<unknown>(null);
  const [running, setRunning] = useState(false);

  const allActions = useMemo(() => toolkits.flatMap((t) => t.actions), [toolkits]);
  const selectedAction = useMemo(() => allActions.find((a) => a.id === actionId), [allActions, actionId]);

  /** Union of a provider's toolkit scopes — requested upfront at OAuth connect. */
  const providerScopes = useCallback(
    (providerId: string): string[] => {
      const set = new Set<string>();
      for (const t of toolkits) if (t.providerId === providerId) for (const s of t.scopes) set.add(s);
      return [...set];
    },
    [toolkits],
  );

  const refresh = useCallback(async () => {
    const [st, tk, cn] = await Promise.all([
      api.get<Status>('/connectors/status'),
      api.get<{ toolkits: ToolkitInfo[] }>('/connectors/toolkits'),
      api.get<{ connections: Connection[] }>('/connectors/connections'),
    ]);
    setStatus(st);
    setToolkits(tk.toolkits);
    setConnections(cn.connections);
    if (!actionId && tk.toolkits[0]?.actions[0]) setActionId(tk.toolkits[0].actions[0].id);
  }, [actionId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const err = params.get('error');
    if (connected) setBanner({ kind: 'ok', text: `Connected ${connected}` });
    else if (err) setBanner({ kind: 'err', text: `Connect failed: ${err}` });
    if (connected || err) window.history.replaceState({}, '', '/connectors-test');
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectOAuth = useCallback(
    async (p: ProviderStatus, authConfigId?: string) => {
      setBusy(true);
      try {
        const { authorizationUrl } = await api.post<{ authorizationUrl: string }>('/connectors/connect', {
          providerId: p.id,
          scopes: providerScopes(p.id),
          label: p.displayName,
          ...(authConfigId ? { authConfigId } : {}), // connect through a SPECIFIC client (BYO)
        });
        window.location.href = authorizationUrl;
      } catch (e) {
        setBanner({ kind: 'err', text: e instanceof Error ? e.message : 'connect failed' });
        setBusy(false);
      }
    },
    [providerScopes],
  );

  const setDefaultByo = useCallback(async (p: ProviderStatus, id: string) => {
    setBusy(true);
    try {
      await api.post('/connectors/auth-configs/default', { providerId: p.id, id });
      const { configs } = await api.get<{ configs: AuthConfigSummary[] }>(`/connectors/auth-configs?providerId=${p.id}`);
      setByoConfigs((c) => ({ ...c, [p.id]: configs }));
    } catch (e) {
      setBanner({ kind: 'err', text: e instanceof Error ? e.message : 'failed to set default' });
    } finally {
      setBusy(false);
    }
  }, []);

  const connectDirect = useCallback(
    async (p: ProviderStatus) => {
      setBusy(true);
      try {
        await api.post('/connectors/connectDirect', { providerId: p.id, fields: creds[p.id] ?? {}, label: p.displayName });
        setBanner({ kind: 'ok', text: `Connected ${p.displayName}` });
        setCreds((c) => ({ ...c, [p.id]: {} }));
        await refresh();
      } catch (e) {
        setBanner({ kind: 'err', text: e instanceof Error ? e.message : 'connect failed' });
      } finally {
        setBusy(false);
      }
    },
    [creds, refresh],
  );

  const redirectUri = status?.redirectUri ?? '';

  const openAdvanced = useCallback(
    async (p: ProviderStatus) => {
      const next = advanced === p.id ? null : p.id;
      setAdvanced(next);
      if (next) {
        setByoForm((f) => ({ ...f, [p.id]: f[p.id] ?? { label: '', clientId: '', clientSecret: '', redirectUri } }));
        const { configs } = await api.get<{ configs: AuthConfigSummary[] }>(`/connectors/auth-configs?providerId=${p.id}`);
        setByoConfigs((c) => ({ ...c, [p.id]: configs }));
      }
    },
    [advanced, redirectUri],
  );

  const setByoField = (providerId: string, field: keyof ByoForm, value: string) =>
    setByoForm((f) => ({
      ...f,
      [providerId]: { ...(f[providerId] ?? { label: '', clientId: '', clientSecret: '', redirectUri }), [field]: value },
    }));

  const addByo = useCallback(
    async (p: ProviderStatus) => {
      const form = byoForm[p.id];
      if (!form?.label || !form?.clientId) {
        setBanner({ kind: 'err', text: 'label and client ID are required' });
        return;
      }
      setBusy(true);
      try {
        await api.post('/connectors/auth-configs', {
          providerId: p.id,
          label: form.label,
          oauth: { clientId: form.clientId, redirectUri: form.redirectUri || redirectUri },
          clientSecret: form.clientSecret || undefined,
        });
        setByoForm((f) => ({ ...f, [p.id]: { label: '', clientId: '', clientSecret: '', redirectUri } }));
        const { configs } = await api.get<{ configs: AuthConfigSummary[] }>(`/connectors/auth-configs?providerId=${p.id}`);
        setByoConfigs((c) => ({ ...c, [p.id]: configs }));
        await refresh(); // provider may now be "configured" → enables Connect
        setBanner({ kind: 'ok', text: `Added your ${p.displayName} app` });
      } catch (e) {
        setBanner({ kind: 'err', text: e instanceof Error ? e.message : 'failed to add app' });
      } finally {
        setBusy(false);
      }
    },
    [byoForm, redirectUri, refresh],
  );

  const deleteByo = useCallback(async (p: ProviderStatus, id: string) => {
    setBusy(true);
    try {
      await api.delete(`/connectors/auth-configs?id=${encodeURIComponent(id)}`);
      const { configs } = await api.get<{ configs: AuthConfigSummary[] }>(`/connectors/auth-configs?providerId=${p.id}`);
      setByoConfigs((c) => ({ ...c, [p.id]: configs }));
    } catch (e) {
      setBanner({ kind: 'err', text: e instanceof Error ? e.message : 'failed to remove (in use?)' });
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await api.post('/connectors/disconnect', { id });
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const testConnection = useCallback(
    async (id: string) => {
      setTesting(id);
      try {
        const res = await api.post<{ ok: boolean; status: string; error?: string }>('/connectors/test', { id });
        setTestResults((prev) => ({ ...prev, [id]: res }));
        await refresh(); // the probe may have healed the stored status
      } catch {
        setTestResults((prev) => ({ ...prev, [id]: { ok: false, status: 'error', error: 'probe failed' } }));
      } finally {
        setTesting(null);
      }
    },
    [refresh],
  );

  const runLiveChecks = useCallback(async (c: Connection) => {
    const checks = LIVE_CHECKS[c.providerId];
    if (!checks?.length) return;
    setLiveRunning(c.id);
    setLiveResults((prev) => ({ ...prev, [c.id]: [] }));
    const account = c.email || c.label || c.accountId;
    const out: LiveCheckResult[] = [];
    for (const check of checks) {
      try {
        const { outcome } = await api.post<{ outcome: { ok?: boolean; reason?: string; code?: string; result?: unknown } }>(
          '/connectors/run',
          { actionId: check.actionId, input: check.input, account },
        );
        if (outcome?.ok) {
          out.push({ label: check.label, ok: true, detail: 'ok' });
        } else {
          out.push({ label: check.label, ok: false, detail: outcome?.reason ?? outcome?.code ?? 'failed' });
        }
      } catch (e) {
        out.push({ label: check.label, ok: false, detail: e instanceof Error ? e.message : String(e) });
      }
      setLiveResults((prev) => ({ ...prev, [c.id]: [...out] }));
    }
    setLiveRunning(null);
  }, []);

  const run = useCallback(async () => {
    setRunning(true);
    setResult(null);
    try {
      let input: unknown = {};
      try {
        input = inputText.trim() ? JSON.parse(inputText) : {};
      } catch {
        setResult({ error: 'Input is not valid JSON' });
        setRunning(false);
        return;
      }
      const { outcome } = await api.post<{ outcome: unknown }>('/connectors/run', {
        actionId,
        input,
        account: account.trim() || undefined,
      });
      setResult(outcome);
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning(false);
    }
  }, [actionId, account, inputText]);

  const setField = (providerId: string, field: string, value: string) =>
    setCreds((c) => ({ ...c, [providerId]: { ...(c[providerId] ?? {}), [field]: value } }));

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-8 font-sans text-sm">
      <header>
        <h1 className="text-xl font-semibold">Connectors test page</h1>
        <p className="text-neutral-500">Exercise real connect, refresh, and actions against the engine.</p>
        {status && (
          <p className="mt-1 text-xs text-neutral-400">
            OAuth redirect URI: <code className="rounded bg-neutral-100 px-1 text-neutral-800">{status.redirectUri}</code>
          </p>
        )}
      </header>

      {banner && (
        <div
          className={`rounded-md border px-3 py-2 ${
            banner.kind === 'ok' ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-800'
          }`}
        >
          {banner.text}
        </div>
      )}

      {/* Connect */}
      <section className="space-y-3">
        <h2 className="font-medium">Providers</h2>
        <ul className="space-y-2">
          {(status?.providers ?? []).map((p) => (
            <li key={p.id} className="rounded-md border border-neutral-200 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-medium">{p.displayName}</span>
                  <span className="ml-2 rounded bg-neutral-100 px-1 text-neutral-800.5 py-0.5 text-xs text-neutral-500">{p.method}</span>
                  {p.method === 'oauth2' && !p.configured && (
                    <span className="ml-2 text-xs text-amber-700">no bundled client, add your own ↓</span>
                  )}
                  {p.method === 'oauth2' && (
                    <button onClick={() => openAdvanced(p)} className="ml-2 text-xs text-blue-600 underline">
                      {advanced === p.id ? 'Hide' : 'Advanced'}
                    </button>
                  )}
                </div>
                {p.method === 'oauth2' ? (
                  <button
                    disabled={busy || !p.configured}
                    onClick={() => connectOAuth(p)}
                    title={p.configured ? '' : 'No client configured, add your own under Advanced'}
                    className="shrink-0 rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-100 disabled:opacity-40"
                  >
                    Connect
                  </button>
                ) : (
                  <div className="flex shrink-0 items-center gap-2">
                    {(p.credentialFields ?? ['apiKey']).map((f) => (
                      <input
                        key={f}
                        type="password"
                        placeholder={f}
                        value={creds[p.id]?.[f] ?? ''}
                        onChange={(e) => setField(p.id, f, e.target.value)}
                        className="w-32 rounded-md border border-neutral-300 px-2 py-1"
                      />
                    ))}
                    <button
                      disabled={busy}
                      onClick={() => connectDirect(p)}
                      className="rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-100 disabled:opacity-40"
                    >
                      Connect
                    </button>
                  </div>
                )}
              </div>

              {p.method === 'oauth2' && advanced === p.id && (
                <div className="mt-3 space-y-2 border-t border-neutral-100 pt-3">
                  <div className="text-xs font-medium text-neutral-600">Bring your own OAuth app</div>
                  <p className="text-xs text-neutral-500">
                    Register an app with {p.displayName}, add the redirect URI{' '}
                    <code className="rounded bg-neutral-100 px-1 text-neutral-800">{redirectUri}</code>, then paste the client below. Stored
                    sealed in your home (<code>.config/connectors</code>), never in the repo.
                  </p>
                  {(byoConfigs[p.id] ?? []).map((cfg) => (
                    <div key={cfg.id} className="flex items-center justify-between rounded bg-neutral-50 px-2 py-1 text-xs text-neutral-800">
                      <span>
                        {cfg.label ?? cfg.id} {cfg.isDefault ? '· default' : ''} · {cfg.status}
                      </span>
                      <span className="flex items-center gap-2">
                        <button onClick={() => connectOAuth(p, cfg.id)} disabled={busy} className="text-blue-600 hover:underline disabled:opacity-40">
                          Connect
                        </button>
                        {!cfg.isDefault && (
                          <button onClick={() => setDefaultByo(p, cfg.id)} disabled={busy} className="text-neutral-600 hover:underline disabled:opacity-40">
                            Set default
                          </button>
                        )}
                        <button onClick={() => deleteByo(p, cfg.id)} disabled={busy} className="text-red-600 hover:underline disabled:opacity-40">
                          Remove
                        </button>
                      </span>
                    </div>
                  ))}
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      placeholder="Label (e.g. Work)"
                      value={byoForm[p.id]?.label ?? ''}
                      onChange={(e) => setByoField(p.id, 'label', e.target.value)}
                      className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
                    />
                    <input
                      placeholder="Client ID"
                      value={byoForm[p.id]?.clientId ?? ''}
                      onChange={(e) => setByoField(p.id, 'clientId', e.target.value)}
                      className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
                    />
                    <input
                      type="password"
                      placeholder="Client secret (blank for PKCE)"
                      value={byoForm[p.id]?.clientSecret ?? ''}
                      onChange={(e) => setByoField(p.id, 'clientSecret', e.target.value)}
                      className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
                    />
                    <input
                      placeholder="Redirect URI"
                      value={byoForm[p.id]?.redirectUri ?? redirectUri}
                      onChange={(e) => setByoField(p.id, 'redirectUri', e.target.value)}
                      className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
                    />
                  </div>
                  <button
                    onClick={() => addByo(p)}
                    disabled={busy}
                    className="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40"
                  >
                    Add app
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Connections */}
      <section className="space-y-3">
        <h2 className="font-medium">Connections ({connections.length})</h2>
        {connections.length === 0 && <p className="text-neutral-500">None yet.</p>}
        <ul className="space-y-2">
          {connections.map((c) => (
            <li key={c.id} className="rounded-md border border-neutral-200 px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="font-medium">{c.email ?? c.label ?? c.accountId}</div>
                  <div className="truncate text-xs text-neutral-500">
                    {c.providerId} · {c.status} · {c.scopes.length} scope(s)
                    {testResults[c.id] && (
                      <span className={testResults[c.id]!.ok ? 'text-green-600' : 'text-red-600'}>
                        {' '}· {testResults[c.id]!.ok ? '✓ healthy' : `✗ ${testResults[c.id]!.status}`}
                        {testResults[c.id]!.error ? ` (${testResults[c.id]!.error})` : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  {LIVE_CHECKS[c.providerId]?.length && (
                    <button
                      disabled={busy || liveRunning === c.id}
                      onClick={() => runLiveChecks(c)}
                      title="Run safe read-only calls against the live API"
                      className="rounded-md border border-neutral-300 px-2 py-1 text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
                    >
                      {liveRunning === c.id ? 'Checking…' : 'Live checks'}
                    </button>
                  )}
                  <button
                    disabled={busy || testing === c.id}
                    onClick={() => testConnection(c.id)}
                    className="rounded-md border border-neutral-300 px-2 py-1 text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
                  >
                    {testing === c.id ? 'Testing…' : 'Test'}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => disconnect(c.id)}
                    className="rounded-md border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50 disabled:opacity-40"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
              {liveResults[c.id]?.length ? (
                <ul className="mt-2 space-y-1 border-t border-neutral-100 pt-2 text-xs">
                  {liveResults[c.id]!.map((r, i) => (
                    <li key={i} className={r.ok ? 'text-green-700' : 'text-red-700'}>
                      {r.ok ? '✓' : '✗'} {r.label}
                      {r.ok ? '' : ` — ${r.detail}`}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {/* Run an action */}
      <section className="space-y-3">
        <h2 className="font-medium">Run an action</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs text-neutral-500">Action</span>
            <select
              value={actionId}
              onChange={(e) => setActionId(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-2 py-1.5"
            >
              {toolkits.map((t) => (
                <optgroup key={t.id} label={t.displayName}>
                  {t.actions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id} {a.mutating ? `(${a.risk})` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-neutral-500">Account (email/label, optional)</span>
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="omit if only one connected"
              className="w-full rounded-md border border-neutral-300 px-2 py-1.5"
            />
          </label>
        </div>
        {selectedAction && (
          <p className="text-xs text-neutral-500">
            {selectedAction.description}
            {selectedAction.scopes.length > 0 && <> · scopes: {selectedAction.scopes.join(', ')}</>}
          </p>
        )}
        <label className="space-y-1">
          <span className="text-xs text-neutral-500">Input (JSON)</span>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={5}
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 font-mono text-xs"
          />
        </label>
        <button
          disabled={running || !actionId}
          onClick={run}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-white hover:bg-neutral-700 disabled:opacity-40"
        >
          {running ? 'Running…' : 'Run'}
        </button>
        {result !== null && (
          <pre className="overflow-auto rounded-md border border-neutral-800 bg-neutral-900 p-3 font-mono text-xs text-neutral-100">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </section>
    </div>
  );
}

'use client';

/**
 * Controlled connector-scope picker (docs/connectors-workspace-scoping-spec.md §7). Renders the
 * connected *services* (toolkits) grouped under their provider with a provider-level select-all,
 * a per-service toggle, an account pin when a service has >1 connected account, and a dormant
 * section for stored-but-disconnected scopes. Pure value + onChange — the parent owns persistence
 * (create payload vs PUT). Shared by the workspace settings sheet and the create modal so both
 * surfaces are identical.
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, AlertCircle, Plug } from 'lucide-react';
import { api } from '@/lib/api/client';
import { Checkbox } from '@/components/ui/checkbox';
import { ConnectorLogo } from '@/components/connectors/connector-logo';
import type { WorkspaceConnectorScope, WorkspaceConnectorScopeAccount } from '@/db/types';

interface Toolkit {
  id: string;
  displayName: string;
  providerId: string;
}
interface ProviderStatus {
  id: string;
  displayName: string;
}
interface Connection {
  id: string;
  providerId: string;
  accountId: string;
  authConfigId?: string | null;
  email?: string | null;
  label?: string | null;
}

function errMsg(e: unknown): string {
  const body = (e as { body?: { error?: string } }).body;
  if (body?.error) return body.error;
  return e instanceof Error ? e.message : String(e);
}

const accountLabel = (c: Connection): string => c.email || c.label || c.accountId;

// A pin carries both accountId and authConfigId because the same account can be connected through
// two OAuth clients — accountId alone wouldn't identify one connection. Match on both.
const connMatchesPin = (c: Connection, pin?: WorkspaceConnectorScopeAccount): boolean =>
  !!pin && c.accountId === pin.accountId && (c.authConfigId ?? undefined) === (pin.authConfigId ?? undefined);
const pinOf = (c: Connection): WorkspaceConnectorScopeAccount => ({
  accountId: c.accountId,
  ...(c.authConfigId ? { authConfigId: c.authConfigId } : {}),
});

interface ConnectorScopePickerProps {
  scopes: WorkspaceConnectorScope[];
  onChange: (scopes: WorkspaceConnectorScope[]) => void;
  disabled?: boolean;
}

export function ConnectorScopePicker({ scopes, onChange, disabled }: ConnectorScopePickerProps) {
  const [toolkits, setToolkits] = useState<Toolkit[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<{ toolkits: Toolkit[] }>('/connectors/toolkits'),
      api.get<{ providers: ProviderStatus[] }>('/connectors/status'),
      api.get<{ connections: Connection[] }>('/connectors/connections'),
    ])
      .then(([tk, st, cn]) => {
        setToolkits(tk.toolkits);
        setProviders(st.providers);
        setConnections(cn.connections);
      })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, []);

  const connectedProviderIds = useMemo(() => new Set(connections.map((c) => c.providerId)), [connections]);
  const providerName = useMemo(() => {
    const m = new Map(providers.map((p) => [p.id, p.displayName]));
    return (pid: string) => m.get(pid) ?? pid.replace(/^mcp_/, 'MCP: ').replace(/_/g, ' ');
  }, [providers]);

  // Connected providers (sorted) → their toolkits. Only connected providers can be scoped.
  const groups = useMemo(() => {
    const byProvider = new Map<string, Toolkit[]>();
    for (const t of toolkits) {
      if (!connectedProviderIds.has(t.providerId)) continue;
      byProvider.set(t.providerId, [...(byProvider.get(t.providerId) ?? []), t]);
    }
    return [...byProvider.entries()]
      .map(([pid, tks]) => ({
        providerId: pid,
        toolkits: tks.sort((a, b) => a.displayName.localeCompare(b.displayName)),
        accounts: connections.filter((c) => c.providerId === pid),
      }))
      .sort((a, b) => providerName(a.providerId).localeCompare(providerName(b.providerId)));
  }, [toolkits, connectedProviderIds, connections, providerName]);

  // Stored scopes whose toolkit isn't currently connected → dormant (kept, but inert until reconnect).
  const connectedToolkitIds = useMemo(
    () => new Set(toolkits.filter((t) => connectedProviderIds.has(t.providerId)).map((t) => t.id)),
    [toolkits, connectedProviderIds],
  );
  const dormant = scopes.filter((s) => !connectedToolkitIds.has(s.toolkitId));

  const scopeFor = (toolkitId: string) => scopes.find((s) => s.toolkitId === toolkitId);
  const toggleToolkit = (toolkitId: string, on: boolean) =>
    onChange(on ? [...scopes.filter((s) => s.toolkitId !== toolkitId), { toolkitId }] : scopes.filter((s) => s.toolkitId !== toolkitId));
  const setAccount = (toolkitId: string, account?: WorkspaceConnectorScopeAccount) =>
    onChange(scopes.map((s) => (s.toolkitId === toolkitId ? { toolkitId, ...(account ? { account } : {}) } : s)));
  const toggleProvider = (toolkitIds: string[], on: boolean) => {
    const without = scopes.filter((s) => !toolkitIds.includes(s.toolkitId));
    onChange(on ? [...without, ...toolkitIds.map((toolkitId) => ({ toolkitId }))] : without);
  };
  const removeDormant = (toolkitId: string) => onChange(scopes.filter((s) => s.toolkitId !== toolkitId));

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <Loader2 size={14} className="animate-spin" /> Loading connectors…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/10 p-6 text-center">
          <Plug size={20} className="mb-2 text-muted-foreground" />
          <p className="text-[12px] text-muted-foreground">
            No connected services yet. Connect them in Settings → Connectors, then scope them here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(({ providerId, toolkits: tks, accounts }) => {
            const ids = tks.map((t) => t.id);
            const selectedCount = ids.filter((id) => scopeFor(id)).length;
            const allOn = selectedCount === ids.length;
            const someOn = selectedCount > 0 && !allOn;
            return (
              <div key={providerId} className="rounded-xl border border-border bg-card/20 p-3">
                <label className="flex cursor-pointer items-center gap-2.5">
                  <Checkbox
                    checked={allOn ? true : someOn ? 'indeterminate' : false}
                    disabled={disabled}
                    onCheckedChange={() => toggleProvider(ids, !allOn)}
                  />
                  <ConnectorLogo providerId={providerId} name={providerName(providerId)} size={24} />
                  <span className="text-sm font-medium text-foreground">{providerName(providerId)}</span>
                </label>
                <div className="mt-2 space-y-1.5 border-t border-border/40 pt-2">
                  {tks.map((t) => {
                    const scope = scopeFor(t.id);
                    const on = !!scope;
                    return (
                      <div key={t.id} className="flex items-center gap-2 pl-1">
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                          <Checkbox
                            checked={on}
                            disabled={disabled}
                            onCheckedChange={() => toggleToolkit(t.id, !on)}
                          />
                          <span className="truncate text-xs text-foreground/90">{t.displayName}</span>
                        </label>
                        {on && accounts.length > 1 && (
                          <select
                            value={accounts.find((c) => connMatchesPin(c, scope?.account))?.id ?? ''}
                            disabled={disabled}
                            onChange={(e) => {
                              const c = accounts.find((a) => a.id === e.target.value);
                              setAccount(t.id, c ? pinOf(c) : undefined);
                            }}
                            className="h-7 max-w-[160px] rounded-lg border border-border bg-input/30 px-1.5 text-[11px] text-foreground"
                          >
                            <option value="">All accounts</option>
                            {accounts.map((c) => (
                              <option key={c.id} value={c.id}>
                                {accountLabel(c)}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dormant.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">Disconnected (kept, inactive)</p>
          {dormant.map((s) => (
            <div key={s.toolkitId} className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="truncate font-mono">
                {s.toolkitId}
                {s.account ? ` · ${s.account.accountId}` : ''}
              </span>
              <button
                type="button"
                onClick={() => removeDormant(s.toolkitId)}
                disabled={disabled}
                className="shrink-0 text-destructive hover:underline disabled:opacity-40"
              >
                Remove
              </button>
            </div>
          ))}
          <p className="text-[10px] leading-normal text-amber-700/80 dark:text-amber-400/80">
            Reconnect the service to reactivate it, or remove it here.
          </p>
        </div>
      )}
    </div>
  );
}

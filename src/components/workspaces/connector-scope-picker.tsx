'use client';

import { trpcClient } from '@/lib/trpc/client';
/**
 * Controlled connector-scope picker (docs/connectors-workspace-scoping-spec.md §7). Renders the
 * connected *services* (toolkits) grouped under their provider with a provider-level select-all,
 * a per-service toggle, an account multiselect when a service has >1 connected account, and a
 * dormant section for stored-but-disconnected scopes. Pure value + onChange — the parent owns
 * persistence (create payload vs PUT). Shared by the workspace settings sheet and the create modal
 * so both surfaces are identical.
 */
import { ConnectorLogo } from '@/components/connectors/connector-logo';
import { Checkbox } from '@/components/ui/checkbox';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { WorkspaceConnectorScope, WorkspaceConnectorScopeAccount } from '@/db/types';
import { pinKey, pinMatchesConnection, scopePins, toggleAccountPin } from '@/lib/connectors/scope-pins';
import { AlertCircle, ChevronDown, Loader2, Plug } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

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
const isPinned = (c: Connection, pins: WorkspaceConnectorScopeAccount[]): boolean =>
  pins.some((p) => pinMatchesConnection(p, c));

interface AccountMultiSelectProps {
  serviceName: string;
  /** The provider's connected accounts. */
  accounts: Connection[];
  /** The scope's account pins. Empty = all accounts, including ones connected later. */
  pins: WorkspaceConnectorScopeAccount[];
  disabled?: boolean;
  onChange: (pins: WorkspaceConnectorScopeAccount[]) => void;
}

/**
 * Which accounts one service may use. "All accounts" (no pins) also covers accounts connected
 * later, and it is exclusive with the individual accounts: while it is on, no account shows a
 * check, and checking an account switches to just that account. Checking accounts individually
 * stores exactly that set, so picking every account one by one is NOT the same as "All accounts":
 * a newly connected account stays off. The set can't be emptied (unchecking the service is how to
 * remove it), and a pinned account that is no longer connected is listed so the stored intent
 * stays visible and removable.
 */
function AccountMultiSelect({ serviceName, accounts, pins, disabled, onChange }: AccountMultiSelectProps) {
  const all = pins.length === 0;
  const selected = accounts.filter((c) => isPinned(c, pins));
  const dormant = pins.filter((p) => !accounts.some((c) => pinMatchesConnection(p, c)));
  const lastOne = !all && pins.length === 1;

  const summary = all
    ? 'All accounts'
    : selected.length === 1 && dormant.length === 0
      ? accountLabel(selected[0]!)
      : selected.length === 0
        ? 'Account not connected'
        : `${selected.length} of ${accounts.length} accounts`;
  const dormantNote = dormant.length === 1 ? '1 chosen account is not connected' : `${dormant.length} chosen accounts are not connected`;

  // "All accounts" works like a radio: checking it clears the pins, and clicking it while on does
  // nothing, since turning it off would leave no accounts. Picking an account is how to leave it.
  const selectAll = () => {
    if (!all) onChange([]);
  };
  // From "All accounts", checking one account narrows the service to just that account.
  const toggleAccount = (c: Connection) => onChange(toggleAccountPin(pins, c));
  const removePin = (pin: WorkspaceConnectorScopeAccount) => onChange(pins.filter((p) => pinKey(p) !== pinKey(pin)));
  // Keep the menu open so several accounts can be toggled in one go.
  const stayOpen = (e: Event) => e.preventDefault();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={`Accounts ${serviceName} may use: ${summary}`}
        title={dormant.length > 0 ? dormantNote : summary}
        className="flex h-7 min-w-0 max-w-[55%] shrink-0 items-center gap-1 rounded-lg border border-border bg-input/30 px-2 text-[11px] text-foreground outline-none transition-colors hover:bg-input/50 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 @sm:max-w-[200px]"
      >
        {dormant.length > 0 && <AlertCircle size={11} className="shrink-0 text-amber-600 dark:text-amber-400" />}
        <span className="truncate">{summary}</span>
        <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-2rem)]">
        <DropdownMenuCheckboxItem checked={all} onCheckedChange={selectAll} onSelect={stayOpen} className="items-start text-xs">
          <span className="min-w-0">
            <span className="block font-medium">All accounts</span>
            <span className="block text-[10px] text-muted-foreground">Includes accounts you connect later</span>
          </span>
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {accounts.map((c) => {
          // No pins is "All accounts", which checks no individual account.
          const checked = isPinned(c, pins);
          return (
            <DropdownMenuCheckboxItem
              key={c.id}
              checked={checked}
              disabled={lastOne && checked}
              onCheckedChange={() => toggleAccount(c)}
              onSelect={stayOpen}
              className="text-xs"
            >
              <span className="truncate">{accountLabel(c)}</span>
            </DropdownMenuCheckboxItem>
          );
        })}
        {dormant.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="py-1.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
              Not connected (kept, inactive)
            </DropdownMenuLabel>
            {dormant.map((p) => (
              <DropdownMenuCheckboxItem
                key={pinKey(p)}
                checked
                disabled={lastOne}
                onCheckedChange={() => removePin(p)}
                onSelect={stayOpen}
                className="text-xs"
              >
                <span className="truncate font-mono text-[11px] text-muted-foreground">{p.accountId}</span>
              </DropdownMenuCheckboxItem>
            ))}
          </>
        )}
        {!all && (
          <p className="px-3 pb-1.5 pt-1 text-[10px] leading-normal text-muted-foreground">
            Only the checked accounts. Accounts you connect later stay off until you add them.
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
      trpcClient.connectors.toolkitsGet.query({}),
      trpcClient.connectors.statusGet.query({}),
      trpcClient.connectors.connectionsGet.query({}),
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
  // Always writes the current shape: no pins = all accounts, otherwise `accounts`.
  const setAccounts = (toolkitId: string, pins: WorkspaceConnectorScopeAccount[]) =>
    onChange(scopes.map((s) => (s.toolkitId === toolkitId ? { toolkitId, ...(pins.length > 0 ? { accounts: pins } : {}) } : s)));
  const toggleProvider = (toolkitIds: string[], on: boolean) => {
    const without = scopes.filter((s) => !toolkitIds.includes(s.toolkitId));
    // Turning a provider on keeps the account choices of services that were already on.
    const added = toolkitIds.filter((id) => !scopeFor(id)).map((toolkitId) => ({ toolkitId }));
    onChange(on ? [...scopes, ...added] : without);
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
    <div className="@container space-y-3">
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
            No connected services yet. Connect them in Settings, under Plugins, then scope them here.
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
                    const pins = scope ? scopePins(scope) : [];
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
                        {/* Shown with >1 account, or while a pin exists so it stays visible and removable. */}
                        {on && (accounts.length > 1 || pins.length > 0) && (
                          <AccountMultiSelect
                            serviceName={t.displayName}
                            accounts={accounts}
                            pins={pins}
                            disabled={disabled}
                            onChange={(next) => setAccounts(t.id, next)}
                          />
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
          {dormant.map((s) => {
            const pins = scopePins(s);
            return (
              <div key={s.toolkitId} className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span className="min-w-0 truncate font-mono" title={pins.map((p) => p.accountId).join(', ')}>
                  {s.toolkitId}
                  {pins.length === 1 ? ` · ${pins[0]!.accountId}` : pins.length > 1 ? ` · ${pins.length} accounts` : ''}
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
            );
          })}
          <p className="text-[10px] leading-normal text-amber-700/80 dark:text-amber-400/80">
            Reconnect the service to reactivate it, or remove it here.
          </p>
        </div>
      )}
    </div>
  );
}

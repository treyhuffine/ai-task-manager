'use client';

/**
 * Workspace connectors (docs/connectors-workspace-scoping-spec.md §7). A sticky, per-workspace
 * allowlist of *services* (toolkits), optionally pinned to one account, that this workspace's
 * executions may use. The orchestrator always has every connected service; this only governs
 * workspace executions. The grouped picker UI is shared with the create modal via
 * ConnectorScopePicker; this wrapper adds the load-current / dirty / save (PUT + recycle) behavior.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { ConnectorScopePicker } from './connector-scope-picker';
import type { WorkspaceConnectorScope } from '@/db/types';

function errMsg(e: unknown): string {
  const body = (e as { body?: { error?: string } }).body;
  if (body?.error) return body.error;
  return e instanceof Error ? e.message : String(e);
}

function normalize(xs: WorkspaceConnectorScope[]): string {
  return JSON.stringify(
    [...xs]
      .map((s) => ({ t: s.toolkitId, a: s.account ? `${s.account.accountId}:${s.account.authConfigId ?? ''}` : '' }))
      .sort((a, b) => a.t.localeCompare(b.t)),
  );
}

export function WorkspaceConnectorsSection({ workspaceId }: { workspaceId: string }) {
  const [scopes, setScopes] = useState<WorkspaceConnectorScope[]>([]);
  const [savedScopes, setSavedScopes] = useState<WorkspaceConnectorScope[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ connectorScopes?: WorkspaceConnectorScope[] }>(`/workspaces/${workspaceId}`)
      .then((ws) => {
        setScopes(ws.connectorScopes ?? []);
        setSavedScopes(ws.connectorScopes ?? []);
      })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  const dirty = useMemo(() => normalize(scopes) !== normalize(savedScopes), [scopes, savedScopes]);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/workspaces/${workspaceId}/connector-scopes`, { scopes });
      setSavedScopes(scopes);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, [workspaceId, scopes]);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Connectors</h3>
        <p className="text-[12px] leading-normal text-muted-foreground">
          Services agents running in this workspace may use. The orchestrator always has every connected service; this
          only scopes this workspace&apos;s executions.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Loading connectors…
        </div>
      ) : (
        <ConnectorScopePicker scopes={scopes} onChange={setScopes} disabled={busy} />
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy || loading || !dirty} className="text-xs font-semibold">
          {busy ? <Loader2 size={14} className="animate-spin" /> : null} Save connectors
        </Button>
        {dirty && !busy && <span className="text-[11px] text-muted-foreground">Unsaved changes</span>}
      </div>
    </div>
  );
}

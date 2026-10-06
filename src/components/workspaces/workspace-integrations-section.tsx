'use client';

import { INTEGRATION_LABELS } from '@/constants/integrations';
import { trpcClient } from '@/lib/trpc/client';
/**
 * Workspace integrations (docs/integrations-workspace-scoping-spec.md §7). A sticky, per-workspace
 * allowlist of *services* (toolkits), optionally limited to some accounts, that this workspace's
 * executions and its main chat may use (docs/agents-view-spec.md Phase 6). The app's main chat
 * always has every connected service. The grouped picker UI is shared with the create modal via
 * IntegrationScopePicker; this wrapper adds the load-current / dirty / save (PUT + recycle) behavior.
 */
import { Button } from '@/components/ui/button';
import type { WorkspaceIntegrationScope } from '@/db/types';
import { pinKey, scopePins } from '@/lib/integrations/scope-pins';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { IntegrationScopePicker } from './integration-scope-picker';

function errMsg(e: unknown): string {
  const body = (e as { body?: { error?: string } }).body;
  if (body?.error) return body.error;
  return e instanceof Error ? e.message : String(e);
}

/** Order-insensitive identity of a scope list: services, each with its sorted account set. */
function normalize(xs: WorkspaceIntegrationScope[]): string {
  return JSON.stringify(
    [...xs]
      .map((s) => ({ t: s.toolkitId, a: scopePins(s).map(pinKey).sort() }))
      .sort((a, b) => a.t.localeCompare(b.t)),
  );
}

export function WorkspaceIntegrationsSection({ workspaceId }: { workspaceId: string }) {
  const [scopes, setScopes] = useState<WorkspaceIntegrationScope[]>([]);
  const [savedScopes, setSavedScopes] = useState<WorkspaceIntegrationScope[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trpcClient.workspaces.get.query({params: {id: workspaceId}})
      .then((ws) => {
        setScopes(ws.integrationScopes ?? []);
        setSavedScopes(ws.integrationScopes ?? []);
      })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  const dirty = useMemo(() => normalize(scopes) !== normalize(savedScopes), [scopes, savedScopes]);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await trpcClient.workspaces.integrationScopesPut.mutate({params: {id: workspaceId}, body: { scopes }});
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
        <h3 className="text-sm font-semibold text-foreground">{INTEGRATION_LABELS.plural}</h3>
        <p className="text-[12px] leading-normal text-muted-foreground">
          Services this agent may use, in its executions and its main chat. The app&apos;s main chat always has every
          connected service.
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
          <Loader2 size={14} className="animate-spin" /> Loading {INTEGRATION_LABELS.plural.toLowerCase()}…
        </div>
      ) : (
        <IntegrationScopePicker scopes={scopes} onChange={setScopes} disabled={busy} />
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy || loading || !dirty} className="text-xs font-semibold">
          {busy ? <Loader2 size={14} className="animate-spin" /> : null} Save {INTEGRATION_LABELS.plural.toLowerCase()}
        </Button>
        {dirty && !busy && <span className="text-[11px] text-muted-foreground">Unsaved changes</span>}
      </div>
    </div>
  );
}

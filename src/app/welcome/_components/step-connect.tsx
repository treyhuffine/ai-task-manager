'use client';

/**
 * Connect your calendar during onboarding — the one moment the app asks.
 * The calendar powers the day view, the HUD glance, and deck sizing, all
 * read-only. Fully skippable: without a connection the calendar surfaces
 * simply stay hidden (no nagging later; the calendar tab keeps a connect
 * path for whenever).
 *
 * The OAuth redirect leaves the page. Wizard state survives in
 * sessionStorage (see wizard.tsx) and the connect API parks a returnTo
 * cookie so the callback lands back on /welcome with a result query.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { ConnectorLogo } from '@/components/connectors/connector-logo';

interface ToolkitInfo {
  id: string;
  providerId: string;
  scopes: string[];
}

interface Connection {
  id: string;
  providerId: string;
  email?: string | null;
  label?: string | null;
}

const CALENDAR_PROVIDERS = [
  { providerId: 'google', toolkitId: 'google_calendar', name: 'Google Calendar' },
  { providerId: 'microsoft', toolkitId: 'outlook_calendar', name: 'Outlook Calendar' },
] as const;

export function StepConnect() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [toolkits, setToolkits] = useState<ToolkitInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // The OAuth callback bounces back with ?connected= or ?error= — read,
    // surface, and strip them from the URL.
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err) setError(`Connect failed: ${err}`);
    if (params.get('connected') || err) {
      params.delete('connected');
      params.delete('error');
      const qs = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }

    Promise.all([
      api.get<{ connections: Connection[] }>('/connectors/connections'),
      api.get<{ toolkits: ToolkitInfo[] }>('/connectors/toolkits'),
    ])
      .then(([cn, tk]) => {
        setConnections(cn.connections);
        setToolkits(tk.toolkits);
      })
      .catch(() => setError('Could not load connector status'))
      .finally(() => setLoaded(true));
  }, []);

  const connect = useCallback(
    async (providerId: string, toolkitId: string, name: string) => {
      setBusy(providerId);
      setError(null);
      try {
        // Calendar scopes only — the provider adds its identity scopes, and
        // broader services (mail, docs) stay an explicit choice in Settings.
        const scopes = toolkits.find((t) => t.id === toolkitId)?.scopes;
        const { authorizationUrl } = await api.post<{ authorizationUrl: string }>(
          '/connectors/connect',
          { providerId, scopes, label: name, returnTo: '/welcome' },
        );
        window.location.href = authorizationUrl;
      } catch (e) {
        const code = (e as { body?: { error?: string } }).body?.error;
        setError(
          code === 'provider_not_configured'
            ? 'This provider has no OAuth client configured yet. You can set one up later in Settings.'
            : `Could not start the connection${code ? ` (${code})` : ''}. You can retry, or connect later from Settings.`,
        );
        setBusy(null);
      }
    },
    [toolkits],
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">See your day here</h1>
        <p className="text-sm text-muted-foreground">
          Connect a calendar and your real day appears throughout the app: a glanceable
          next-event button, an hour-by-hour day view beside your tasks, and a deck that
          sizes itself to the time you actually have. Read-only, and entirely optional.
        </p>
      </div>

      <div className="space-y-2">
        {CALENDAR_PROVIDERS.map(({ providerId, toolkitId, name }) => {
          const connected = connections.filter((c) => c.providerId === providerId);
          const isBusy = busy === providerId;
          return (
            <div
              key={providerId}
              className="flex items-center gap-3 rounded-lg border border-border p-3"
            >
              <ConnectorLogo providerId={providerId} name={name} size={28} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{name}</p>
                {connected.length > 0 ? (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground truncate">
                    <Check className="size-3 text-primary" />
                    Connected{connected[0].email ? ` as ${connected[0].email}` : ''}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Read-only access to your events</p>
                )}
              </div>
              {connected.length === 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!loaded || isBusy}
                  onClick={() => connect(providerId, toolkitId, name)}
                >
                  {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Connect
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Skip freely. You can connect anytime from Settings, where more services (mail,
        docs, messaging) also live.
      </p>
    </div>
  );
}

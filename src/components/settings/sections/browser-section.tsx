'use client';

import { useCallback, useEffect, useState } from 'react';
import { Globe, LogIn, Power, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { api, apiErrorText } from '@/lib/api/client';

interface DetectedBrowser {
  flavor: string;
  label: string;
  executablePath: string;
}

interface AuditEntry {
  ts: string;
  action: string;
  url?: string;
  kind?: string;
  detail?: string;
  blocked?: string;
}

interface BrowserStatus {
  enabled: boolean;
  open: boolean;
  config: {
    enabled: boolean;
    headlessDefault: boolean;
    chromiumPath: string | null;
    defaultProfile: string;
    detected: DetectedBrowser[];
  };
  audit: AuditEntry[];
}

/**
 * Agent browser settings: enable the capability, pick which installed browser
 * to drive, sign into sites once (a headed window), and see recent activity.
 * The one human action is "Open agent browser" then logging in. Config persists
 * to the machine-local AuthConfig via `/api/browser`.
 */
export function BrowserSection() {
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api.get<BrowserStatus>('/browser'));
      setError(null);
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback(
    async (body: { enabled?: boolean; chromiumPath?: string | null; defaultProfile?: string | null }) => {
      setBusy('patch');
      setError(null);
      try {
        setStatus(await api.patch<BrowserStatus>('/browser', body));
      } catch (e) {
        setError(apiErrorText(e));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const [profileInput, setProfileInput] = useState('');
  const configDefaultProfile = status?.config.defaultProfile;
  useEffect(() => {
    if (configDefaultProfile) setProfileInput(configDefaultProfile);
  }, [configDefaultProfile]);

  const saveProfile = useCallback(() => {
    const next = profileInput.trim();
    if (status && next && next !== status.config.defaultProfile && /^[a-zA-Z0-9_-]{1,64}$/.test(next)) {
      void patch({ defaultProfile: next });
    }
  }, [profileInput, status, patch]);

  const control = useCallback(
    async (action: 'open' | 'stop') => {
      setBusy(action);
      setError(null);
      try {
        await api.post('/browser', { action });
        await load();
      } catch (e) {
        setError(apiErrorText(e));
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  if (loading) {
    return <p className="text-sm text-muted-foreground/60">Loading browser settings…</p>;
  }
  if (!status) {
    return (
      <p className="text-sm text-red-500">{error ?? 'Could not load browser settings.'}</p>
    );
  }

  const { config, enabled, open } = status;
  const detected = config.detected;
  const resolvedPath = config.chromiumPath ?? detected[0]?.executablePath ?? null;

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-2.5 text-[12px] text-red-500">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {/* Master toggle */}
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-background p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Globe size={16} className="text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Agent browser</p>
            <p className="text-[11px] text-muted-foreground/60">
              Let the agent read and act on web pages, using sites you sign into once.
            </p>
          </div>
        </div>
        <Switch
          checked={enabled}
          disabled={busy !== null}
          onCheckedChange={(next) => patch({ enabled: next })}
          aria-label="Enable the agent browser"
        />
      </label>

      {enabled && (
        <>
          {/* Browser picker */}
          <div className="rounded-lg border border-border bg-background p-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60">Browser</p>
            {detected.length === 0 ? (
              <p className="mt-2 text-[12px] text-amber-500">
                No Chromium-family browser found. Install Chrome, Brave, Edge, or Chromium.
              </p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {detected.map((b) => {
                  const active = b.executablePath === resolvedPath;
                  const isDefault = config.chromiumPath === null && detected[0]?.executablePath === b.executablePath;
                  return (
                    <button
                      key={b.executablePath}
                      onClick={() => patch({ chromiumPath: b.executablePath })}
                      disabled={busy !== null}
                      className={`flex w-full items-center justify-between rounded-md border p-2.5 text-left transition-all ${
                        active
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                          : 'border-border bg-background hover:border-muted-foreground/30'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {b.label}
                          {isDefault && (
                            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground/70">
                              Default
                            </span>
                          )}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground/50">{b.executablePath}</p>
                      </div>
                      {active && <CheckCircle2 size={14} className="shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Default profile */}
          <div className="rounded-lg border border-border bg-background p-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60">Default profile</p>
            <p className="mt-1 text-[11px] text-muted-foreground/60">
              The logged-in identity actions use when none is given. Letters, digits, underscore, or hyphen.
            </p>
            <input
              value={profileInput}
              disabled={busy !== null}
              onChange={(e) => setProfileInput(e.target.value)}
              onBlur={saveProfile}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              className="mt-2 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary"
              placeholder="agent"
              aria-label="Default browser profile name"
            />
          </div>

          {/* Login + status */}
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${open ? 'bg-emerald-500' : 'bg-muted-foreground/30'}`}
                />
                <p className="text-sm font-medium text-foreground">
                  {open ? 'Running' : 'Not running'}
                </p>
              </div>
              <button
                onClick={() => void load()}
                className="text-muted-foreground/50 hover:text-foreground"
                aria-label="Refresh status"
              >
                <RefreshCw size={13} />
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground/60">
              Open the browser to sign into a site once. The session is saved to a dedicated agent
              profile, separate from your personal browser, and reused later.
            </p>
            <div className="mt-2.5 flex gap-2">
              <button
                onClick={() => void control('open')}
                disabled={busy !== null || detected.length === 0}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <LogIn size={13} />
                {busy === 'open' ? 'Opening…' : 'Open to sign in'}
              </button>
              {open && (
                <button
                  onClick={() => void control('stop')}
                  disabled={busy !== null}
                  className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <Power size={13} />
                  {busy === 'stop' ? 'Stopping…' : 'Stop'}
                </button>
              )}
            </div>
          </div>

          {/* Recent activity */}
          {status.audit.length > 0 && (
            <div className="rounded-lg border border-border bg-background p-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60">
                Recent activity
              </p>
              <ul className="mt-2 space-y-1">
                {status.audit
                  .slice(-8)
                  .reverse()
                  .map((e, i) => (
                    <li key={i} className="flex items-baseline gap-2 text-[11px] text-muted-foreground/70">
                      <span className="font-mono text-muted-foreground/40">
                        {new Date(e.ts).toLocaleTimeString()}
                      </span>
                      <span className="font-medium text-foreground/80">{e.action.replace('browser_', '')}</span>
                      {e.blocked && <span className="text-amber-500">blocked: {e.blocked}</span>}
                      {e.url && <span className="truncate text-muted-foreground/50">{e.url}</span>}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Globe,
  Check,
  Loader2,
  Trash2,
  CheckCircle2,
  AlertCircle,
  WandSparkles,
  RefreshCw,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { usePreviewSettings } from '@/hooks/use-preview';
import { ApiError } from '@/lib/api/client';
import { settingsApi, type PairBaseUrls } from '@/lib/api/settings';
import { isValidPreviewLabel, MAX_LABEL_LENGTH } from '@/lib/preview/preview-name';
import { tunnelHostPreview } from '@/lib/auth/tunnel-host';
import { APP_SHORT_ID } from '@/constants/app';
import { cn } from '@/lib/utils';
import { setSettingsSection } from './settings-store';

/**
 * CRUD for the remote base URL stored in ~/<APP_SHORT_ID>/config.json.
 * This is the hostname new device pairing URLs will be built against so
 * remote/off-network devices can reach this host.
 *
 * The Test button hits `${url}/api/health` from the browser (cross-origin,
 * unauth) and tells the user whether the URL actually resolves back to a
 * flow server. Hints on failure are tailored to common setups — the big
 * one being Tailscale MagicDNS, which requires the *current* device to
 * have Tailscale active even though other devices may still be able to
 * pair successfully via the same URL.
 */

type TestResult =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; url: string }
  | { status: 'error'; headline: string; hints: string[] };

function normalizeForTest(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

async function runTest(rawUrl: string): Promise<TestResult> {
  const url = normalizeForTest(rawUrl);
  if (!url) {
    return {
      status: 'error',
      headline: `That doesn't look like a valid URL.`,
      hints: [`Include the scheme, e.g. https://${APP_SHORT_ID}.example.com`],
    };
  }

  try {
    const res = await fetch(`${url}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      return {
        status: 'error',
        headline: `Reached ${url} but it returned HTTP ${res.status}.`,
        hints: [
          `Another app may be serving this URL, or your tunnel is pointing somewhere unexpected.`,
          `Confirm the tunnel/proxy forwards to this machine on the ${APP_SHORT_ID} port.`,
        ],
      };
    }

    const body = (await res.json().catch(() => null)) as { app?: string } | null;
    if (!body || body.app !== APP_SHORT_ID) {
      return {
        status: 'error',
        headline: `Reached ${url} but it doesn't look like ${APP_SHORT_ID}.`,
        hints: [
          `Another app is already serving this URL.`,
          `Check that your tunnel/proxy forwards to this machine's ${APP_SHORT_ID} port.`,
        ],
      };
    }

    return { status: 'ok', url };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const timedOut = name === 'TimeoutError' || name === 'AbortError';
    return {
      status: 'error',
      headline: timedOut
        ? `Request to ${url} timed out.`
        : `Couldn't reach ${url} from this browser.`,
      hints: [
        `Double-check the URL and port. LAN / Tailscale / direct routes need ":port". Tunnels on 80/443 (ngrok, Cloudflare Tunnel) don't.`,
        `Make sure the tunnel or reverse proxy is running.`,
        `If this is a Tailscale MagicDNS URL, Tailscale must be active on this device. Other devices may still be able to pair even when yours can't.`,
      ],
    };
  }
}

export function RemoteBaseUrlSection() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'base-url'],
    queryFn: () => settingsApi.getBaseUrls(),
  });
  const {
    data: previewSettings,
    isLoading: previewSettingsLoading,
    isFetching: previewSettingsFetching,
    refetch: refetchPreviewSettings,
  } = usePreviewSettings();

  const saved = data?.tunnel ?? null;
  const beamd = previewSettings?.beamd ?? null;
  const beamdConnected = beamd?.connected ?? false;
  const [draftOverride, setDraftOverride] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>({ status: 'idle' });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [nameDraftOverride, setNameDraftOverride] = useState<string | null>(null);
  const [nameNotice, setNameNotice] = useState<string | null>(null);
  const draft = draftOverride ?? saved ?? '';

  const saveMutation = useMutation({
    mutationFn: (value: string | null) => settingsApi.setTunnelUrl(value),
    onSuccess: (res) => {
      queryClient.setQueryData(['settings', 'base-url'], res);
      setDraftOverride(null);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    },
  });

  const autoTunnelMutation = useMutation({
    mutationFn: (enabled: boolean) => settingsApi.setAutoTunnel(enabled),
    onSuccess: (res) => {
      queryClient.setQueryData(['settings', 'base-url'], res);
      if (res.tunnel) setTestResult({ status: 'ok', url: res.tunnel });
    },
    onError: (err) => {
      // A second machine on one beamd account collides on the default name —
      // open Advanced so the fix is already on screen.
      if (beamdErrorCode(err) === 'beamd_name_taken') setAdvancedOpen(true);
    },
  });

  // Custom tunnel name (Advanced). The default is derived from the app id and
  // is therefore identical on every machine, so anyone running a second
  // instance on the same beamd account needs their own name here.
  const nameSaved = data?.tunnelName ?? '';
  const nameDraft = nameDraftOverride ?? nameSaved;
  const nameNormalized = nameDraft.trim().toLowerCase();
  const nameDirty = nameNormalized !== nameSaved;
  const nameValid = nameNormalized === '' || isValidPreviewLabel(nameNormalized);
  const nameLocked = data?.tunnelNameLocked ?? false;

  const nameMutation = useMutation({
    mutationFn: (value: string | null) => settingsApi.setTunnelName(value),
    onSuccess: (res) => {
      queryClient.setQueryData<PairBaseUrls>(['settings', 'base-url'], res);
      setNameDraftOverride(null);
      if (res.reopened) {
        setTestResult({ status: 'ok', url: res.reopened.url });
        setNameNotice(`Tunnel re-opened at ${res.reopened.url}`);
      } else {
        setTestResult({ status: 'idle' });
        setNameNotice(
          `Saved. Choose "${beamdConnected ? 'Use Beamd URL' : 'Connect Beamd'}" to open the tunnel under this name.`,
        );
      }
    },
    onError: () => setNameNotice(null),
  });

  const beamdMutation = useMutation({
    mutationFn: () => settingsApi.useBeamdTunnelUrl(),
    onError: (err) => {
      if (beamdErrorCode(err) === 'beamd_name_taken') setAdvancedOpen(true);
    },
    onSuccess: async (res) => {
      queryClient.setQueryData<PairBaseUrls>(['settings', 'base-url'], res);
      setDraftOverride(null);
      setTestResult({ status: 'ok', url: res.beamd.url });
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
      // Prompt hard: a tunnel that vanishes on restart is the #1 footgun for
      // a remote box. If auto-reconnect isn't already on, push for it now
      // while the URL is fresh in their mind.
      if (!res.autoTunnel) {
        const yes = await confirm({
          title: 'Keep Flow reachable automatically?',
          description: (
            <>
              Turn on auto-reconnect so Flow re-opens this Beamd tunnel every time it
              starts. Without it, a restart or reboot leaves this machine unreachable
              until you reconnect by hand.
            </>
          ),
          confirmLabel: 'Turn on auto-reconnect',
          cancelLabel: 'Not now',
        });
        if (yes) autoTunnelMutation.mutate(true);
      }
    },
  });

  const nameHostPreview = tunnelHostPreview(
    saved,
    data?.effectiveTunnelName ?? null,
    nameNormalized || data?.defaultTunnelName || '',
  );

  const dirty = (draft.trim() || null) !== saved;
  const testTarget = draft.trim();
  const canTest = !!testTarget && testResult.status !== 'testing';
  const checkingBeamd = previewSettingsLoading || previewSettingsFetching;
  const busy =
    isLoading ||
    saveMutation.isPending ||
    beamdMutation.isPending ||
    autoTunnelMutation.isPending ||
    nameMutation.isPending;

  const handleTest = async () => {
    if (!canTest) return;
    setTestResult({ status: 'testing' });
    const result = await runTest(testTarget);
    setTestResult(result);
  };

  // Reset test result if the user edits the URL after running a test.
  const handleChange = (value: string) => {
    setDraftOverride(value);
    if (testResult.status !== 'idle') setTestResult({ status: 'idle' });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Globe size={14} className="text-muted-foreground" />
        <h3 className="text-sm font-medium text-foreground">Remote base URL</h3>
      </div>
      <p className="text-[11px] text-muted-foreground/70">
        The URL a remote device would paste in its browser to reach this machine. Anything works, port and all.
      </p>

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
        {checkingBeamd ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 size={12} className="animate-spin" />
            Checking Beamd login
          </span>
        ) : beamdConnected ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={12} className="shrink-0" />
            <span className="truncate">
              Beamd connected{beamd?.server ? <> to <span className="font-mono">{beamd.server}</span></> : null}
            </span>
          </span>
        ) : (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
            <AlertCircle size={12} className="shrink-0" />
            <span className="truncate">
              {beamd?.error?.message ?? 'Beamd is not connected on this machine.'}
            </span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {!beamdConnected && !checkingBeamd && (
            <Button size="xs" variant="outline" onClick={() => setSettingsSection('remote-preview')}>
              Connect Beamd
            </Button>
          )}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => refetchPreviewSettings()}
            disabled={checkingBeamd}
            title="Check whether this machine already has a Beamd login from the terminal"
          >
            <RefreshCw size={11} className={checkingBeamd ? 'animate-spin' : ''} />
            Re-check
          </Button>
        </div>
      </div>

      {/* Keep Flow reachable: re-open the Beamd tunnel on every startup so a
          headless/remote box stays accessible across restarts without a manual
          reconnect. Only meaningful for the Beamd tunnel — external tunnels
          (Tailscale, ngrok, Cloudflare) are managed outside Flow. */}
      <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-foreground">
            Reconnect automatically on startup
          </div>
          <p className="text-[11px] text-muted-foreground/70">
            {beamdConnected
              ? 'Flow re-opens this Beamd tunnel every time it starts, so this machine stays reachable after restarts and reboots.'
              : 'Connect Beamd first, then Flow can keep the tunnel up on every startup.'}
          </p>
          {autoTunnelMutation.isError && (
            <p className="mt-1 text-[11px] text-destructive">
              {beamdErrorMessage(autoTunnelMutation.error)}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {autoTunnelMutation.isPending && (
            <Loader2 size={12} className="animate-spin text-muted-foreground" />
          )}
          <Switch
            checked={data?.autoTunnel ?? false}
            disabled={!beamdConnected || busy}
            onCheckedChange={(v) => autoTunnelMutation.mutate(v)}
            aria-label="Reconnect automatically on startup"
          />
        </div>
      </div>

      {!saved && !isLoading && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
          <AlertCircle size={12} className="mt-0.5 shrink-0 text-amber-500" />
          <p className="text-[11px] text-foreground/90">
            No remote URL set yet. Devices off your network can&apos;t reach this app, and notification deep links
            won&apos;t open on your phone. Set one below if you use remote access.
          </p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="url"
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={`https://${APP_SHORT_ID}.example.com`}
          disabled={busy}
          className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && dirty && draft.trim()) {
              saveMutation.mutate(draft.trim());
            }
          }}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => saveMutation.mutate(draft.trim() || null)}
          disabled={!dirty || busy}
        >
          {saveMutation.isPending ? (
            <Loader2 size={12} className="animate-spin" />
          ) : justSaved ? (
            <Check size={12} />
          ) : null}
          {justSaved ? 'Saved' : 'Save'}
        </Button>
        {saved && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => saveMutation.mutate(null)}
            disabled={busy}
            aria-label="Clear remote base URL"
          >
            <Trash2 size={12} />
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            if (beamdConnected) {
              beamdMutation.mutate();
            } else {
              setSettingsSection('remote-preview');
            }
          }}
          disabled={busy || checkingBeamd}
          title={
            beamdConnected
              ? 'Open a Beamd tunnel to this Flow server and save the returned URL'
              : 'Connect this machine to Beamd first'
          }
        >
          {beamdMutation.isPending ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <WandSparkles size={11} />
          )}
          {beamdConnected ? 'Use Beamd URL' : 'Connect Beamd'}
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={handleTest}
          disabled={!canTest || busy}
        >
          {testResult.status === 'testing' ? (
            <Loader2 size={11} className="animate-spin" />
          ) : null}
          Test connection
        </Button>
        {testResult.status === 'ok' && (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={12} />
            Reachable from this browser
          </span>
        )}
      </div>

      {beamdMutation.isError && (
        <p className="text-[11px] text-destructive">
          {beamdErrorMessage(beamdMutation.error)}
        </p>
      )}

      {testResult.status === 'error' && (
        <div className="mt-1 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-1.5">
          <div className="flex items-start gap-2">
            <AlertCircle size={12} className="mt-0.5 shrink-0 text-amber-500" />
            <p className="text-[11px] text-foreground font-medium break-all">
              {testResult.headline}
            </p>
          </div>
          <ul className="text-[11px] text-muted-foreground/80 space-y-1 pl-5 list-disc">
            {testResult.hints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Advanced: the Beamd tunnel name. Collapsed by default, auto-opened
          when Beamd rejects the name as taken — which is exactly what happens
          when a second machine on the same account uses the default. */}
      <div className="border-t border-border/60 pt-2">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <ChevronRight size={11} className={cn('transition-transform', advancedOpen && 'rotate-90')} />
          Advanced: Beamd tunnel name
          {!advancedOpen && data?.effectiveTunnelName && (
            <span className="font-mono text-foreground/70">({data.effectiveTunnelName})</span>
          )}
        </button>

        {advancedOpen && (
          <div className="mt-2 space-y-2">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Beamd names are unique per edge, and the default is the same on every install. If
              another machine of yours already holds{' '}
              <span className="font-mono text-foreground/80">{data?.defaultTunnelName ?? APP_SHORT_ID}</span>, give this
              one its own name.
            </p>

            <div className="flex items-center gap-2">
              <input
                value={nameDraft}
                onChange={(e) => {
                  setNameDraftOverride(e.target.value);
                  setNameNotice(null);
                }}
                placeholder={data?.defaultTunnelName ?? APP_SHORT_ID}
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                maxLength={MAX_LABEL_LENGTH}
                disabled={busy || nameLocked}
                className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && nameDirty && nameValid) {
                    nameMutation.mutate(nameNormalized || null);
                  }
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => nameMutation.mutate(nameNormalized || null)}
                disabled={!nameDirty || !nameValid || busy || nameLocked}
              >
                {nameMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
                Save name
              </Button>
              {nameSaved && !nameLocked && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => nameMutation.mutate(null)}
                  disabled={busy}
                  title={`Revert to the default name (${data?.defaultTunnelName ?? APP_SHORT_ID})`}
                  aria-label="Revert to the default tunnel name"
                >
                  <Trash2 size={12} />
                </Button>
              )}
            </div>

            {nameLocked && (
              <p className="text-[11px] text-muted-foreground">
                <span className="font-mono text-foreground/80">{data?.tunnelNameEnvVar}</span> is set on this server, so
                it decides the name. Unset it to edit the name here.
              </p>
            )}

            {!nameValid && (
              <p className="text-[11px] text-destructive">
                Letters, numbers and hyphens only, up to {MAX_LABEL_LENGTH} characters, no leading or trailing hyphen.
              </p>
            )}

            {nameValid && nameHostPreview && (
              <p className="text-[11px] text-muted-foreground/70">
                Opens at <span className="font-mono text-foreground/80 break-all">{nameHostPreview}</span>
              </p>
            )}

            {nameMutation.isError && (
              <p className="text-[11px] text-destructive">{beamdErrorMessage(nameMutation.error)}</p>
            )}

            {nameNotice && !nameMutation.isError && (
              <p className="inline-flex items-start gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
                <span className="break-all">{nameNotice}</span>
              </p>
            )}
          </div>
        )}
      </div>

      <div className="pt-1 space-y-0.5">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50">Examples</p>
        <ul className="text-[11px] text-muted-foreground/60 font-mono space-y-0.5">
          <li>https://{APP_SHORT_ID}.example.com <span className="font-sans text-muted-foreground/50">(tunnel on 443)</span></li>
          <li>http://mac.tail-scale.ts.net:4224 <span className="font-sans text-muted-foreground/50">(Tailscale MagicDNS)</span></li>
          <li>https://{APP_SHORT_ID}.example.com:8443 <span className="font-sans text-muted-foreground/50">(self-hosted custom port)</span></li>
        </ul>
      </div>

      {saveMutation.isError && (
        <p className="text-[11px] text-destructive">
          {saveMutation.error instanceof Error ? saveMutation.error.message : 'Failed to save.'}
        </p>
      )}
    </div>
  );
}

/** Stable error code from an API error body, for branching on failure kind. */
function beamdErrorCode(err: unknown): string | null {
  if (err instanceof ApiError && err.body && typeof err.body === 'object') {
    const body = err.body as { error?: unknown };
    if (typeof body.error === 'string') return body.error;
  }
  return null;
}

function beamdErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.body && typeof err.body === 'object') {
    const body = err.body as { message?: unknown };
    if (typeof body.message === 'string' && body.message.trim()) return body.message;
  }
  return err instanceof Error ? err.message : 'Beamd could not create a remote URL.';
}

'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Check, Loader2, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { settingsApi } from '@/lib/api/settings';
import { APP_SHORT_ID } from '@/constants/app';

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
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'base-url'],
    queryFn: () => settingsApi.getBaseUrls(),
  });

  const saved = data?.tunnel ?? null;
  const [draftOverride, setDraftOverride] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>({ status: 'idle' });
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

  const dirty = (draft.trim() || null) !== saved;
  const testTarget = draft.trim();
  const canTest = !!testTarget && testResult.status !== 'testing';

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
          disabled={isLoading || saveMutation.isPending}
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
          disabled={!dirty || saveMutation.isPending}
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
            disabled={saveMutation.isPending}
            aria-label="Clear remote base URL"
          >
            <Trash2 size={12} />
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 pt-0.5">
        <Button
          size="xs"
          variant="outline"
          onClick={handleTest}
          disabled={!canTest}
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

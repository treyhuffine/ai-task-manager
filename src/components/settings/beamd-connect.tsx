'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, ChevronRight, RefreshCw, AlertTriangle, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePreviewSettings, useUpdatePreviewSettings, useTestBeamd, useConnectDevice } from '@/hooks/use-preview';
import type { BeamdBinInfo } from '@/lib/api/preview';

const BIN_SOURCE_LABEL: Record<BeamdBinInfo['source'], string> = {
  env: 'FLOW_BEAMD_BIN',
  path: 'your installed beamd',
  'bundled-native': "Flow's bundled beamd",
  'bundled-shim': "Flow's bundled beamd",
  fallback: 'beamd on PATH',
};

/** "via beamd 0.0.3 · your installed beamd" — which binary Flow resolved to. */
function BinLine({ bin }: { bin: BeamdBinInfo }) {
  return (
    <p className="text-[11px] text-muted-foreground/70" title={bin.path}>
      via beamd{bin.version ? ` ${bin.version}` : ''} · {BIN_SOURCE_LABEL[bin.source]}
    </p>
  );
}

/**
 * The beamd connection block — shared by the Devices → Remote preview panel
 * and the per-preview "Open on another device" flow. Drives the machine's
 * shared `~/.beamd/` account (Flow stores no credential).
 *
 * Hosted-first: one **"Connect with Beamd"** button does browser-approve
 * (device login) against hosted beamd — no inputs. A collapsed **"Self-hosted
 * edge or API key"** section below holds the edge address + API-key (token)
 * path for OSS/self-hosted; it auto-opens when an edge can't do browser
 * approval. The edge field (when set) also points the approve button at a
 * non-default edge (e.g. staging).
 *
 * `onConnected` fires after a verified connect (either path) — the share popover
 * uses it to flip the active provider to beamd and re-resolve a URL.
 */
export function BeamdConnect({ onConnected }: { onConnected?: () => void }) {
  const { data: settings, refetch, isFetching } = usePreviewSettings();
  const update = useUpdatePreviewSettings();
  const test = useTestBeamd();
  const device = useConnectDevice();

  const [server, setServer] = useState('');
  const [token, setToken] = useState('');
  const [insecure, setInsecure] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const connected = settings?.beamd.connected ?? false;
  const bin = settings?.beamd.bin ?? null;
  // A version-skew problem (Flow's beamd too old to read the account) — show it
  // prominently whether or not we read as "connected", since it's the cause.
  const skew =
    settings?.beamd.error?.code === 'beamd_cli_outdated'
      ? settings.beamd.error
      : bin?.outdated
        ? { code: 'beamd_cli_outdated', message: `Flow is using beamd ${bin.version}, older than the ${bin.minVersion}+ it needs.` }
        : null;

  // Self-hosted / API-key section. Auto-opens when the edge can't do browser
  // approval, so the user can drop in an edge + key.
  const advancedVisible = showAdvanced || device.status === 'unsupported';

  // A verified device-code connect lands here — propagate like the token path.
  const handledConnect = useRef(false);
  useEffect(() => {
    if (device.status === 'connected' && !handledConnect.current) {
      handledConnect.current = true;
      onConnected?.();
      refetch();
    }
    if (device.status !== 'connected') handledConnect.current = false;
  }, [device.status, onConnected, refetch]);

  const startApprove = () => {
    setResult(null);
    device.start({ server: server.trim() || undefined, insecure });
  };

  const connect = async () => {
    setResult(null);
    if (!server.trim() || !token.trim()) return;
    try {
      await update.mutateAsync({ connect: { server: server.trim(), token: token.trim(), insecure } });
      setToken('');
      onConnected?.();
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  };

  const disconnect = async () => {
    setResult(null);
    await update.mutateAsync({ disconnect: true });
  };

  const runTest = async () => {
    setResult(null);
    try {
      const res = await test.mutateAsync();
      setResult({ ok: true, text: `Reached ${res.server}${res.slug ? ` (workspace: ${res.slug})` : ''}.` });
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="rounded-md border border-border bg-card/40 p-3 space-y-2.5">
      {skew && (
        <div className="flex items-start gap-1.5 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{skew.message}</span>
        </div>
      )}

      {connected ? (
        <>
          <div className="flex items-center gap-1.5 text-[12px] text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={13} className="shrink-0" />
            <span>
              This machine is connected to <span className="font-mono">{settings?.beamd.server}</span>.
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            beamd is logged in on this machine. Flow, your terminal, and agents all share it.
          </p>
          {bin && <BinLine bin={bin} />}
          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={runTest}
              disabled={test.isPending}
              className="flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1.5 text-[12px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
              title="Authenticate against the edge (beamd check)"
            >
              {test.isPending && <Loader2 size={12} className="animate-spin" />}
              Test connection
            </button>
            <button
              type="button"
              onClick={disconnect}
              disabled={update.isPending}
              className="flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {update.isPending && <Loader2 size={12} className="animate-spin" />}
              Disconnect
            </button>
          </div>
        </>
      ) : device.status === 'pending' ? (
        <div className="space-y-2.5">
          <p className="text-[12px] text-foreground">Approve this device in your browser to finish connecting.</p>
          {device.pending?.userCode && (
            <p className="text-[11px] text-muted-foreground">
              Confirm the code{' '}
              <span className="font-mono text-[13px] font-semibold tracking-wider text-foreground">
                {device.pending.userCode}
              </span>
            </p>
          )}
          <div className="flex items-center gap-2">
            <a
              href={device.pending?.verificationUriComplete || device.pending?.verificationUri || '#'}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded border border-border bg-foreground px-2.5 py-1.5 text-[12px] font-medium text-background hover:bg-foreground/90"
            >
              <ExternalLink size={12} />
              Approve in browser
            </a>
            <button
              type="button"
              onClick={device.cancel}
              className="rounded border border-border bg-background px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 size={12} className="animate-spin" />
            Waiting for approval…
          </p>
        </div>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground">
            Connect this machine to beamd to share previews to your phone or another device. The login is stored by
            beamd (in <span className="font-mono">~/.beamd</span>), not by Flow. Your terminal and agents share it.
          </p>

          {/* Primary path: browser approval against hosted beamd — no inputs. */}
          <button
            type="button"
            onClick={startApprove}
            disabled={device.status === 'starting'}
            className="flex w-full items-center justify-center gap-1.5 rounded border border-border bg-foreground px-2.5 py-2 text-[12px] font-medium text-background hover:bg-foreground/90 disabled:opacity-50"
          >
            {device.status === 'starting' ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
            Connect with Beamd
          </button>
          {device.status === 'error' && device.error && (
            <p className="flex items-start gap-1.5 text-[12px] text-amber-600 dark:text-amber-400">
              <XCircle size={13} className="mt-0.5 shrink-0" />
              <span>{device.error}</span>
            </p>
          )}

          {/* Advanced: self-hosted edge / API key. Auto-opens when an edge
              can't do browser approval. */}
          <div className="border-t border-border/60 pt-2">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ChevronRight size={11} className={cn('transition-transform', advancedVisible && 'rotate-90')} />
              Self-hosted edge or API key
            </button>

            {advancedVisible && (
              <div className="mt-2 space-y-2.5">
                {device.status === 'unsupported' && (
                  <p className="text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
                    {device.error || 'That edge can’t do browser approval. Enter it below with an API key.'}
                  </p>
                )}
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Running your own beamd edge, or pointing at a non-default one? Enter it, then either approve in your
                  browser with <span className="font-medium text-foreground">Connect with Beamd</span> above, or paste an
                  API key.
                </p>
                <Field label="Edge address">
                  <input
                    value={server}
                    onChange={(e) => setServer(e.target.value)}
                    placeholder="your-beamd-edge.com  ·  blank = hosted beamd"
                    spellCheck={false}
                    className="w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </Field>
                <Field label="API key">
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="your edge token, or a dashboard API key"
                    spellCheck={false}
                    autoComplete="off"
                    className="w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </Field>
                <label className="flex items-start gap-2 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={insecure}
                    onChange={(e) => setInsecure(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    Skip TLS verification
                    <span className="block text-muted-foreground/70">Only for a self-hosted edge with a self-signed cert.</span>
                  </span>
                </label>
                <button
                  type="button"
                  onClick={connect}
                  disabled={update.isPending || !server.trim() || !token.trim()}
                  className="flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1.5 text-[12px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                >
                  {update.isPending && <Loader2 size={12} className="animate-spin" />}
                  {update.isPending ? 'Verifying…' : 'Log in with API key'}
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Check whether this machine already has a beamd login (e.g. from `beamd login` in a terminal)"
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw size={11} className={cn(isFetching && 'animate-spin')} />
            Already logged in? Re-check
          </button>
        </>
      )}

      {result && (
        <div
          className={cn(
            'flex items-start gap-1.5 text-[12px]',
            result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
          )}
        >
          {result.ok ? (
            <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
          ) : (
            <XCircle size={13} className="mt-0.5 shrink-0" />
          )}
          <span>{result.text}</span>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

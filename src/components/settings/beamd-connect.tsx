'use client';

import { useState } from 'react';
import { Loader2, CheckCircle2, XCircle, ChevronRight, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePreviewSettings, useUpdatePreviewSettings, useTestBeamd } from '@/hooks/use-preview';

/**
 * The beamd connection block — shared by the Devices → Remote preview panel
 * and the per-preview "Open on another device" flow. Drives the machine's
 * shared `~/.beamd/` account (Flow stores no credential): "Connect" runs
 * `beamd login` + verifies, "Disconnect" runs `beamd logout".
 *
 * `onConnected` fires after a verified connect — the share popover uses it to
 * flip the active provider to beamd and re-resolve a URL without a round-trip
 * through settings.
 */
export function BeamdConnect({ onConnected }: { onConnected?: () => void }) {
  const { data: settings, refetch, isFetching } = usePreviewSettings();
  const update = useUpdatePreviewSettings();
  const test = useTestBeamd();

  const [server, setServer] = useState('');
  const [token, setToken] = useState('');
  const [insecure, setInsecure] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const connected = settings?.beamd.connected ?? false;

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
      {connected ? (
        <>
          <div className="flex items-center gap-1.5 text-[12px] text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={13} className="shrink-0" />
            <span>
              This machine is connected to <span className="font-mono">{settings?.beamd.server}</span>.
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            beamd is logged in on this machine — Flow, your terminal, and agents all share it.
          </p>
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
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground">
            Connect this machine to beamd. The login is stored by beamd (in <span className="font-mono">~/.beamd</span>),
            not by Flow — your terminal and agents use the same one.
          </p>
          <Field label="Server">
            <input
              value={server}
              onChange={(e) => setServer(e.target.value)}
              placeholder="beamd.ai  ·  or your self-hosted edge"
              spellCheck={false}
              className="w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </Field>
          <Field label="Workspace API key">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="from your beamd dashboard, or an OSS edge token"
              spellCheck={false}
              autoComplete="off"
              className="w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </Field>

          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ChevronRight size={11} className={cn('transition-transform', showHelp && 'rotate-90')} />
            Where do I get a key?
          </button>
          {showHelp && (
            <div className="rounded border border-border/60 bg-background/60 p-2 text-[11px] leading-relaxed text-muted-foreground space-y-1.5">
              <p>
                <span className="font-medium text-foreground">Hosted beamd:</span> sign in to your beamd dashboard and
                create a workspace API key, then paste it above with the server set to your beamd host.
              </p>
              <p>
                <span className="font-medium text-foreground">Self-hosted (free):</span> run your own beamd edge and use
                its token. Point <span className="font-mono">Server</span> at that edge; tick “Skip TLS verification” only
                if it serves a self-signed cert.
              </p>
              <p className="text-muted-foreground/70">
                Already ran <span className="font-mono">beamd login</span> in a terminal? You don’t need this — Flow uses
                that same login automatically.
              </p>
            </div>
          )}

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
          <div className="flex items-center gap-3 pt-0.5">
            <button
              type="button"
              onClick={connect}
              disabled={update.isPending || !server.trim() || !token.trim()}
              className="flex items-center gap-1.5 rounded border border-border bg-foreground px-2.5 py-1.5 text-[12px] font-medium text-background hover:bg-foreground/90 disabled:opacity-50"
            >
              {update.isPending && <Loader2 size={12} className="animate-spin" />}
              {update.isPending ? 'Verifying…' : 'Log in to Beamd'}
            </button>
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
          </div>
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

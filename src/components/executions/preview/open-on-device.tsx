'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Smartphone,
  Loader2,
  Copy,
  Check,
  ExternalLink,
  RotateCw,
  Globe,
  AlertCircle,
  Settings2,
} from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { previewApi, type PreviewState } from '@/lib/api/preview';
import { usePreviewSettings, useUpdatePreviewSettings } from '@/hooks/use-preview';
import { QrCode } from '@/components/settings/qr-code';
import { BeamdConnect } from '@/components/settings/beamd-connect';
import { openRemotePreviewSettings } from '@/components/dashboard/devices-sheet';
import { cn } from '@/lib/utils';

/** Error codes that mean "remote isn't wired up yet" — i.e. the user just
 *  needs to connect beamd and/or point the picker at it. */
const SETUP_CODES = new Set([
  'beamd_not_configured',
  'beamd_not_connected',
  'beamd_unauthorized',
  'unauthorized',
  'no_remote_provider',
]);

/**
 * "Open on your phone" — the outcome-framed entry to remote preview.
 *
 * Opening the popover resolves a shareable URL for *this execution* by bringing
 * its per-execution tunnel up on demand (`start({ remote: true })`). The
 * desktop keeps its fast localhost iframe untouched — same supervised server,
 * we just also ask the active provider for a public URL.
 *
 * When remote isn't wired up yet, the same popover folds in the fix inline:
 *   - machine not connected to beamd → the connect form (verified on submit);
 *   - connected but the picker is localhost-only → one-tap "Use Beamd".
 * Either way it then re-resolves to the QR. Provider-agnostic: the QR is just
 * whatever URL the active provider returns.
 */
export function OpenOnDevice({
  executionId,
  open,
  onOpenChange,
}: {
  executionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: settings } = usePreviewSettings();
  const updateSettings = useUpdatePreviewSettings();
  const [state, setState] = useState<PreviewState | null>(null);
  const [copied, setCopied] = useState(false);

  const resolve = useMutation({
    mutationFn: () => previewApi.start(executionId, { remote: true }),
    onSuccess: setState,
  });

  // Re-resolve from scratch on (re)open and whenever the execution changes.
  useEffect(() => {
    if (open && !state && !resolve.isPending) resolve.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) setState(null);
  }, [open]);
  useEffect(() => {
    setState(null);
  }, [executionId]);

  // Point the picker at beamd (if it isn't already) and resolve again — used
  // both after a fresh connect and for the already-logged-in one-tap path.
  const useBeamdAndResolve = async () => {
    if (settings?.activeProvider !== 'beamd') {
      await updateSettings.mutateAsync({ activeProvider: 'beamd' });
    }
    setState(null);
    resolve.mutate();
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  const url = state?.remoteUrl ?? null;
  const err = state?.remoteError ?? null;
  const beamdConnected = settings?.beamd.connected ?? false;
  const providerLabel = state?.activeRemoteProviderLabel ?? 'Beamd';

  const resolving = resolve.isPending && !url && !err;
  const setupNeeded = !!err && SETUP_CODES.has(err.code);
  // Reconnect when not logged in or the stored credential was rejected; a
  // simple provider switch when we're logged in but the picker is elsewhere.
  const needsLogin = setupNeeded && (!beamdConnected || err.code === 'beamd_unauthorized' || err.code === 'unauthorized');
  const needsSwitch = setupNeeded && !needsLogin;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-7 items-center gap-1.5 rounded px-2 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Open on your phone"
          aria-label="Open on your phone"
        >
          <Smartphone size={13} />
          <span className="hidden sm:inline">Phone</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-3.5 py-2.5">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
            <Smartphone size={13} className="text-muted-foreground" />
            Open on your phone
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Scan to load this preview live — your phone, a tablet, or anyone you share the link with.
          </p>
        </div>

        <div className="px-3.5 py-3">
          {resolving && (
            <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />
              Creating a shareable link…
            </div>
          )}

          {!resolving && url && (
            <div className="flex flex-col items-center gap-3">
              <QrCode value={url} size={184} />
              <p className="text-center text-[11px] text-muted-foreground">
                Scan with your phone’s camera to open it live.
              </p>
              <div className="flex w-full items-center gap-1.5">
                <span className="flex h-7 flex-1 items-center truncate rounded bg-muted/60 px-2 font-mono text-[11px] text-muted-foreground">
                  {url}
                </span>
                <button
                  type="button"
                  onClick={() => copy(url)}
                  className="flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  title={copied ? 'Copied!' : 'Copy link'}
                >
                  {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                </button>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Open in a new tab"
                >
                  <ExternalLink size={13} />
                </a>
              </div>
              <p className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
                <Globe size={10} />
                Live via {providerLabel} while this preview is running.
              </p>
            </div>
          )}

          {!resolving && needsLogin && (
            <div className="space-y-2.5">
              <p className="text-[12px] text-muted-foreground">
                Connect this machine to beamd to make previews reachable anywhere.
              </p>
              <BeamdConnect onConnected={useBeamdAndResolve} />
            </div>
          )}

          {!resolving && needsSwitch && (
            <div className="space-y-2.5">
              <div className="flex items-start gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                <Check size={13} className="mt-0.5 shrink-0" />
                <span>
                  beamd is already set up on this machine. Turn it on for remote previews — nothing else to configure.
                </span>
              </div>
              <button
                type="button"
                onClick={useBeamdAndResolve}
                disabled={updateSettings.isPending || resolve.isPending}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-foreground px-3 py-2 text-[12px] font-medium text-background hover:bg-foreground/90 disabled:opacity-50"
              >
                {(updateSettings.isPending || resolve.isPending) && <Loader2 size={13} className="animate-spin" />}
                <Globe size={13} />
                Use Beamd for remote preview
              </button>
            </div>
          )}

          {!resolving && err && !setupNeeded && (
            <div className="space-y-2.5">
              <div className="flex items-start gap-1.5 text-[12px] text-amber-600 dark:text-amber-400">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">{err.message}</p>
                  {err.hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{err.hint}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setState(null);
                    resolve.mutate();
                  }}
                  disabled={resolve.isPending}
                  className="flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1.5 text-[12px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                >
                  <RotateCw size={12} className={cn(resolve.isPending && 'animate-spin')} />
                  Retry
                </button>
                <button
                  type="button"
                  onClick={openRemotePreviewSettings}
                  className="flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Settings2 size={12} />
                  Settings
                </button>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

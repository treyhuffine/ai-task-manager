'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Check, AlertCircle, MonitorSmartphone, KeyRound, ChevronRight, Terminal, QrCode } from 'lucide-react';
import { APP_NAME, APP_SHORT_ID } from '@/constants/app';
import { setAuthToken } from '@/lib/api/client';
import { QrScannerModal } from '@/components/auth/qr-scanner-modal';

/**
 * Extract a pairing token from a scanned QR payload.
 * QRs may encode either the full pair URL (`http://host/#t=<token>`)
 * or — as a fallback — a raw token. This handles both.
 */
function extractTokenFromQr(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Full URL form — parse the fragment for ?t=
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
      const params = new URLSearchParams(hash);
      const t = params.get('t');
      if (t) return t;
    } catch {
      return null;
    }
    return null;
  }

  // Raw token form — expect `<appId>_<env>_<chars>`
  if (/^[a-z]+_[a-z]+_[A-Za-z0-9]+$/.test(trimmed)) return trimmed;

  return null;
}

/**
 * Unpaired-browser landing page.
 *
 * Primary flow: paste a token and submit. We validate it against an
 * authenticated endpoint (`/api/user-state`) before storing so the user
 * gets immediate feedback on a bad/revoked token instead of bouncing
 * through the app and back.
 *
 * Secondary flow: instructions for getting a token if you don't have one.
 * The CLI path is de-emphasized — the web Devices sheet is the primary
 * source for new pair tokens now that the app is running.
 */
export default function PairPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [token, setToken] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'validating' }
    | { kind: 'ok' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const validateAndSave = useCallback(
    async (candidate: string) => {
      setStatus({ kind: 'validating' });
      try {
        const res = await fetch('/api/user-state', {
          headers: { authorization: `Bearer ${candidate}` },
        });
        if (res.status === 401 || res.status === 403) {
          setStatus({
            kind: 'error',
            message: 'That token was rejected. It may have been revoked or mistyped.',
          });
          return;
        }
        if (!res.ok) {
          setStatus({
            kind: 'error',
            message: `Server returned HTTP ${res.status}. Try again in a moment.`,
          });
          return;
        }
        setAuthToken(candidate);
        setStatus({ kind: 'ok' });
        router.replace('/');
      } catch {
        setStatus({
          kind: 'error',
          message: `Couldn't reach the server. Check your connection and try again.`,
        });
      }
    },
    [router],
  );

  const submit = useCallback(() => {
    const trimmed = token.trim();
    if (!trimmed) return;
    void validateAndSave(trimmed);
  }, [token, validateAndSave]);

  const handleQrDecoded = useCallback(
    (raw: string) => {
      const extracted = extractTokenFromQr(raw);
      if (!extracted) {
        setScannerOpen(false);
        setStatus({
          kind: 'error',
          message: `That QR code doesn't look like a ${APP_NAME} pairing code.`,
        });
        return;
      }
      setScannerOpen(false);
      setToken(extracted);
      void validateAndSave(extracted);
    },
    [validateAndSave],
  );

  const validating = status.kind === 'validating';

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-6 py-10 overflow-hidden">
      {/* Ambient background effects */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
        <div className="absolute -top-1/4 left-1/4 h-[500px] w-[500px] rounded-full bg-primary/10 opacity-50 blur-[100px] mix-blend-screen" />
        <div className="absolute -bottom-1/4 right-1/4 h-[400px] w-[400px] rounded-full bg-accent/10 opacity-50 blur-[120px] mix-blend-screen" />
      </div>

      <div className="relative z-10 w-full max-w-md space-y-8">
        <div className="flex flex-col items-center text-center space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary shadow-inner border border-primary/20 backdrop-blur-md">
            <MonitorSmartphone className="h-7 w-7" />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/80">
            {APP_NAME}
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Device Pairing
          </h1>
          <p className="text-sm text-muted-foreground/90 max-w-[280px] mx-auto leading-relaxed">
            Connect this browser to your secure workspace using a pairing token.
          </p>
        </div>

        <div className="rounded-2xl border border-border/50 bg-card/60 p-6 sm:p-8 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-6 duration-700 delay-150">
          <div className="space-y-6">
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <KeyRound size={14} />
                Pairing Token
              </label>
              
              <div className="group relative">
                <div className="absolute -inset-0.5 rounded-lg bg-gradient-to-r from-primary/30 to-accent/30 opacity-0 blur transition duration-500 group-focus-within:opacity-100" />
                <div className="relative flex items-center gap-2 rounded-lg bg-background/80 p-1.5 border border-border/50 shadow-inner backdrop-blur-xl transition-all hover:bg-background/90 group-focus-within:bg-background">
                  <input
                    ref={inputRef}
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={token}
                    onChange={(e) => {
                      setToken(e.target.value);
                      if (status.kind !== 'idle') setStatus({ kind: 'idle' });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submit();
                    }}
                    placeholder={`${APP_SHORT_ID}_live_…`}
                    disabled={validating}
                    className="w-full flex-1 bg-transparent px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={submit}
                    disabled={!token.trim() || validating}
                    className="inline-flex h-9 shrink-0 shadow-sm items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 hover:scale-[1.02] active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                  >
                    {validating ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : status.kind === 'ok' ? (
                      <Check size={16} />
                    ) : (
                      'Connect'
                    )}
                  </button>
                </div>
              </div>

              {status.kind === 'error' && (
                <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive animate-in fade-in duration-300">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <p>{status.message}</p>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  if (status.kind !== 'idle') setStatus({ kind: 'idle' });
                  setScannerOpen(true);
                }}
                disabled={validating}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-border/50 bg-background/40 px-4 py-2.5 text-sm font-medium text-foreground transition-all hover:bg-background/70 hover:border-border active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
              >
                <QrCode size={16} />
                Scan QR code
              </button>

              <p className="text-xs text-muted-foreground/60">
                You can also open a pair link directly — the token lives in the URL fragment as{' '}
                <code className="rounded bg-muted px-1 mt-0.5 py-0.5 inline-block font-mono text-[10px] text-foreground/80">#t=&lt;token&gt;</code>
              </p>
            </div>

            <div className="h-px w-full bg-gradient-to-r from-transparent via-border to-transparent" />

            <div className="space-y-4 pt-2">
              <h2 className="text-sm font-medium text-foreground">Need a token?</h2>
              <div className="rounded-xl border border-border/50 bg-muted/30 p-4 text-sm shadow-sm transition-colors hover:bg-muted/50 text-muted-foreground/90 leading-relaxed text-xs">
                <p>
                  On any paired device, open the <strong className="text-foreground font-medium">Devices</strong> menu and click <strong className="text-foreground font-medium">Add device</strong>. Paste the raw token here.
                </p>
              </div>

              <details className="group [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer select-none items-center justify-between rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground">
                  <span className="flex items-center gap-2">
                    <Terminal size={14} />
                    Use the host CLI instead
                  </span>
                  <ChevronRight size={14} className="transition-transform duration-200 group-open:rotate-90" />
                </summary>
                <div className="mt-2 space-y-3 px-2 text-xs text-muted-foreground animate-in slide-in-from-top-2 fade-in duration-300">
                  <div>
                    <p className="mb-1.5">On the host machine, run:</p>
                    <span className="block rounded-md border border-border/50 bg-background/50 p-2 font-mono text-[11px] text-foreground shadow-inner">
                      {APP_SHORT_ID} pair
                    </span>
                  </div>
                  <div className="pt-1">
                    <p className="mb-1 text-[11px] text-muted-foreground/70">If pairing off-network for the first time, first set your URL:</p>
                    <span className="block rounded bg-background/50 px-1.5 py-1 font-mono text-[10px] text-foreground border border-border/50 shadow-inner">
                      {APP_SHORT_ID} pair --set-url &lt;url&gt;
                    </span>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </div>

        <p className="text-center text-[11px] text-muted-foreground/40 animate-in fade-in duration-1000 delay-300">
          Tokens are securely validated and stored in localStorage.
        </p>
      </div>

      <QrScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDecoded={handleQrDecoded}
      />
    </div>
  );
}

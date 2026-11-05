'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { getAuthToken, setAuthToken } from '@/lib/api/client';

/** Remembers a cookie sync tried in this tab, so a cookie the browser refuses can't loop the page. */
const TRIED_KEY = 'ri.oauth.cookie-sync';

async function signInWith(token: string): Promise<boolean> {
  const response = await fetch('/api/session', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  return response.ok;
}

/**
 * Signs this browser in to Ri where the app's sign-in opened it, so the app's
 * request survives. A browser that already has Ri's token only needs its
 * cookie. Otherwise the owner pastes a token from Add device, as on /pair.
 */
export function SignInToContinue({ client }: { client: string | null }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pasted, setPasted] = useState('');
  const [state, setState] = useState<'checking' | 'idle' | 'busy' | 'refused'>('checking');

  useEffect(() => {
    const existing = getAuthToken();
    let tried = false;
    try { tried = sessionStorage.getItem(TRIED_KEY) === existing; } catch { /* storage off: try once */ }
    if (existing && !tried) {
      try { sessionStorage.setItem(TRIED_KEY, existing); } catch { /* ignore */ }
    }
    const attempt = existing && !tried ? signInWith(existing) : Promise.resolve(false);
    void attempt.then(ok => (ok ? router.refresh() : setState('idle')), () => setState('idle'));
  }, [router]);

  useEffect(() => { if (state === 'idle') inputRef.current?.focus(); }, [state]);

  if (state === 'checking') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={14} className="animate-spin" aria-hidden /> Checking this browser’s sign-in
      </p>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = pasted.trim();
    if (!token) return;
    setState('busy');
    const ok = await signInWith(token).catch(() => false);
    if (!ok) { setState('refused'); return; }
    setAuthToken(token);
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold text-foreground">Sign in to Ri</h1>
        <p className="text-sm text-muted-foreground">
          {client ? `${client} wants to connect to your Ri.` : 'An app wants to connect to your Ri.'} This browser isn’t one of your Ri devices yet.
        </p>
      </div>
      <label className="block space-y-1.5">
        <span className="text-xs text-muted-foreground">
          On a device where you use Ri, open Settings → Devices, choose Add device and create its pairing link. Copy the token it shows and paste it here. This browser then stays signed in to Ri.
        </span>
        <input
          ref={inputRef}
          value={pasted}
          onChange={event => { setPasted(event.target.value); if (state === 'refused') setState('idle'); }}
          autoComplete="off"
          spellCheck={false}
          placeholder="ri_live_…"
          aria-invalid={state === 'refused'}
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </label>
      {state === 'refused' && <p role="alert" className="text-xs text-destructive">That token didn’t work. Make a new one with Add device.</p>}
      <button
        type="submit"
        disabled={!pasted.trim() || state === 'busy'}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {state === 'busy' && <Loader2 size={14} className="animate-spin" aria-hidden />} Continue
      </button>
    </form>
  );
}

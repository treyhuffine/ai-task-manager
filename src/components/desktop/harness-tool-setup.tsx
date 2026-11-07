'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { RiDesktop } from '@/lib/client/desktop';
import type { HarnessId } from '@/lib/harness/registry';

/** Install and Sign in buttons, so nobody needs a terminal to get a coding tool. */
export function HarnessToolSetup({ harness, installed, onComplete }: { harness: HarnessId; installed: boolean; onComplete(): void }) {
  const [desktop, setDesktop] = useState<RiDesktop>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (window.riDesktop?.setupHarness) setDesktop(window.riDesktop); }, []);
  if (!desktop?.setupHarness || (harness !== 'claude' && harness !== 'codex')) return null;
  const name = harness === 'claude' ? 'Claude Code' : 'Codex';
  return <div className="mt-3 space-y-2">
    <Button variant="outline" disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try { await desktop.setupHarness!({ harness, action: installed ? 'login' : 'install' }); onComplete(); }
      catch (failure) { setError(failure instanceof Error ? failure.message : 'Setup did not finish. Try again.'); }
      finally { setBusy(false); }
    }}>{busy ? (installed ? 'Finish signing in in your browser' : `Installing ${name}…`) : installed ? `Sign in to ${name}` : `Install ${name}`}</Button>
    <p className="text-xs text-muted-foreground">{installed ? 'Your browser opens to finish signing in. Keep Ri open until it finishes.' : 'Ri installs the coding tool for your account on this computer.'}</p>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}

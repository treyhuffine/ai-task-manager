'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { RiDesktop } from '@/lib/client/desktop';

/** Opens trusted local controls, including when this window views a remote Home. */
export function DesktopControls() {
  const [desktop, setDesktop] = useState<RiDesktop>();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (window.riDesktop?.connection) setDesktop(window.riDesktop);
  }, []);
  if (!desktop) return null;

  const open = async () => {
    setOpening(true);
    setError('');
    try { await desktop.connection!('settings'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Desktop settings could not be opened. Try again.'); }
    finally { setOpening(false); }
  };

  return <section aria-label="Desktop settings on this computer" className="space-y-3 rounded-lg border border-border p-3">
    <div>
      <h3 className="text-sm font-medium">This computer</h3>
      <p className="mt-1 text-xs text-muted-foreground">Enable agents on this computer, manage its connection to Ri, and choose how it starts.</p>
    </div>
    <Button type="button" variant="outline" size="sm" disabled={opening} onClick={() => void open()}>
      {opening ? 'Opening desktop settings…' : 'Open desktop settings'}
    </Button>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </section>;
}

'use client';

import { useEffect, useState } from 'react';

/** How long the page is on screen before Allow takes a click, as Ri's approval cards arm (docs/connected-mcp-apps.md). */
const ARM_MS = 500;

/**
 * Cancel and Allow. Allow takes nothing until the page has been visible for
 * a moment, and isn't focused, so a click or key meant for the page that
 * opened this one can't land on it (docs/mcp-oauth.md, "Security").
 */
export function ConsentButtons() {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const arm = () => window.setTimeout(() => setArmed(document.visibilityState === 'visible'), ARM_MS);
    let timer = arm();
    const onVisibility = () => {
      window.clearTimeout(timer);
      setArmed(false);
      timer = arm();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div className="flex gap-2">
      <button type="submit" name="decision" value="deny" className="flex-1 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50">
        Cancel
      </button>
      <button type="submit" name="decision" value="allow" disabled={!armed} className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
        Allow
      </button>
    </div>
  );
}

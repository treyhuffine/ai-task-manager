'use client';

import { Store } from 'lucide-react';
import { openSettings } from '@/components/settings/settings-store';

// Thin strip at the bottom of the expanded rail. A single entry point into
// the connector marketplace — the searchable catalog of external services
// (Gmail, Slack, Notion, ...) agents can act through. Opens the Connectors
// surface directly via the shared settings store. Hidden in skinny mode along
// with the rest of the expanded chrome (the icon-only rail has no room).
//
// Replaces the old ⌘K/⌘J hint labels + theme toggle that used to live here:
// the shortcuts stay global, and theme still toggles from the command palette
// and Settings → General, so nothing is stranded by dropping them.

export function RailFooter() {
  return (
    <footer className="flex-shrink-0 px-2 py-2 border-t border-border/40">
      <button
        type="button"
        onClick={() => openSettings('connectors')}
        aria-label="Open the connector marketplace"
        title="Marketplace"
        className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/60 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 hover:bg-muted/40 transition-colors"
      >
        <Store size={13} className="flex-shrink-0 text-primary" />
        <span>Marketplace</span>
      </button>
    </footer>
  );
}

'use client';

import { Plug, Settings } from 'lucide-react';
import { openSettings } from '@/components/settings/settings-store';
import { INTEGRATION_ICONS } from '@/components/integrations/integration-icon-data';
import { cn } from '@/lib/utils';
import { Tip } from '@/components/ui/tip';

// The bottom of the rail: what you set up rather than visit. Settings, and
// connecting accounts (where agents can act). Both are occasional, so they
// sit below the work instead of above it. Bottom left is where people look
// for settings.
//
// Connect accounts opens Settings → Plugins on its Integrations tab (Gmail,
// Notion, Linear, ... and remote MCP servers). It says "accounts", not
// "apps": a connection is one signed-in account, and Apps in the places
// above are the local apps you open. The collapsed rail keeps only the gear.
// Connect accounts needs its words.
//
// Replaces the old ⌘K/⌘J hint labels + theme toggle that used to live here:
// the shortcuts stay global, and theme still toggles from the command palette
// and Settings → General, so nothing is stranded by dropping them.

/** Apps in the stack: live integrations with a brand mark, drawn as app icons. */
const APPS = ['linear', 'notion', 'gmail'] as const;

/** Where each tile goes on hover and focus: the stack fans out. */
const FAN = [
  'group-hover:-translate-x-1.5 group-hover:-rotate-12 group-focus-visible:-translate-x-1.5 group-focus-visible:-rotate-12',
  'group-hover:-translate-y-1 group-focus-visible:-translate-y-1',
  'group-hover:translate-x-1.5 group-hover:rotate-12 group-focus-visible:translate-x-1.5 group-focus-visible:rotate-12',
];

function AppTile({ id, className }: { id: (typeof APPS)[number]; className?: string }) {
  const icon = INTEGRATION_ICONS[id];
  return (
    <span
      className={cn(
        'relative flex size-5 items-center justify-center rounded-[6px] bg-white shadow-sm ring-2 ring-background',
        'transition-transform duration-300 ease-out motion-reduce:transition-none motion-reduce:transform-none',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" width={12} height={12} fill={`#${icon.hex}`} aria-hidden>
        <path d={icon.path} />
      </svg>
    </span>
  );
}

export function RailFooter({ collapsed }: { collapsed: boolean }) {
  if (collapsed) {
    return (
      <footer className="flex flex-shrink-0 justify-center border-t border-border/40 py-1.5">
        <Tip label="Settings">
          <button
            type="button"
            onClick={() => openSettings()}
            aria-label="Settings"
            className="p-1.5 rounded-md text-muted-foreground/80 hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Settings size={14} />
          </button>
        </Tip>
      </footer>
    );
  }
  return (
    <footer className="flex flex-shrink-0 items-stretch gap-1.5 px-2 py-2 border-t border-border/40">
      <Tip label="Settings">
        <button
          type="button"
          onClick={() => openSettings()}
          aria-label="Settings"
          className="flex w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border/60 text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-colors"
        >
          <Settings size={14} />
        </button>
      </Tip>
      <button
        type="button"
        onClick={() => openSettings('plugins', { anchor: 'integrations' })}
        aria-label="Connect accounts"
        className="group min-w-0 flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border/60 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-colors"
      >
        <Plug size={13} className="flex-shrink-0 text-primary" />
        <span className="truncate">Connect accounts</span>
        <span aria-hidden className="ml-auto flex items-center -space-x-2 pr-0.5">
          {APPS.map((id, i) => (
            <AppTile key={id} id={id} className={FAN[i]} />
          ))}
        </span>
      </button>
    </footer>
  );
}

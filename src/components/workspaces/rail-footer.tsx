'use client';

import { Plug } from 'lucide-react';
import { openSettings } from '@/components/settings/settings-store';
import { CONNECTOR_ICONS } from '@/components/connectors/connector-icon-data';
import { cn } from '@/lib/utils';

// Thin strip at the bottom of the expanded rail: the way into connecting
// apps (Google, Notion, Linear, ... and remote MCP servers) so agents can act
// in them. Opens Settings → Plugins on its Connectors tab. Hidden in
// skinny mode along with the rest of the expanded chrome (the icon-only rail
// has no room).
//
// Replaces the old ⌘K/⌘J hint labels + theme toggle that used to live here:
// the shortcuts stay global, and theme still toggles from the command palette
// and Settings → General, so nothing is stranded by dropping them.

/** Apps in the stack: live connectors with a brand mark, drawn as app icons. */
const APPS = ['google', 'notion', 'linear'] as const;

/** Where each tile goes on hover and focus: the stack fans out. */
const FAN = [
  'group-hover:-translate-x-1.5 group-hover:-rotate-12 group-focus-visible:-translate-x-1.5 group-focus-visible:-rotate-12',
  'group-hover:-translate-y-1 group-focus-visible:-translate-y-1',
  'group-hover:translate-x-1.5 group-hover:rotate-12 group-focus-visible:translate-x-1.5 group-focus-visible:rotate-12',
];

function AppTile({ id, className }: { id: (typeof APPS)[number]; className?: string }) {
  const icon = CONNECTOR_ICONS[id];
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

export function RailFooter() {
  return (
    <footer className="flex-shrink-0 px-2 py-2 border-t border-border/40">
      <button
        type="button"
        onClick={() => openSettings('plugins', { anchor: 'connectors' })}
        aria-label="Connect apps"
        title="Connect apps like Google, Notion and Linear"
        className="group w-full flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/60 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-colors"
      >
        <Plug size={13} className="flex-shrink-0 text-primary" />
        <span>Connect apps</span>
        <span aria-hidden className="ml-auto flex items-center -space-x-1.5 pr-1">
          {APPS.map((id, i) => (
            <AppTile key={id} id={id} className={FAN[i]} />
          ))}
        </span>
      </button>
    </footer>
  );
}

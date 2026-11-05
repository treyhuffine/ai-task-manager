'use client';

import { HOTKEYS } from '@/constants/commands';
import { cn } from '@/lib/utils';
import { Kbd } from '@/components/ui/kbd';
import { Tip } from '@/components/ui/tip';

/**
 * The header's labeled layout toggles, **Terminal** then **Tools**, shared
 * by the execution view and the agent view so both pages have the same
 * buttons in the same order with the same hotkeys. Either can be left out
 * where it doesn't apply (no terminal on a phone or tablet, a Chat / Tools
 * switch instead of the Tools toggle in one-pane mode).
 *
 * The words are on purpose: the two panel glyphs are nearly identical, and
 * a redundant label costs less than a wrong click. Shortcut badges fold away
 * first, then labels fold to icons when the header runs out of room. Each
 * header says where with container-query classes (`fold`), since its room
 * depends on what else it holds. The tooltip keeps the shortcut available.
 */
export function WorkbenchToggles({
  terminal,
  tools,
  fold,
}: {
  terminal?: { open: boolean; onToggle: () => void };
  /** `showLabel` names what the toggle reopens, for its tooltip. */
  tools?: { open: boolean; onToggle: () => void; showLabel: string };
  /** Container-query classes that hide the labels and the shortcut badges. */
  fold: { label: string; kbd: string };
}) {
  return (
    <>
      {terminal && (
        <ToggleButton
          on={terminal.open}
          onClick={terminal.onToggle}
          label="Terminal"
          title={`${terminal.open ? 'Hide' : 'Show'} the terminal. Shells keep running.`}
          shortcut={HOTKEYS.toggleTerminal.label}
          icon={<BottomPanelIcon filled={terminal.open} />}
          fold={fold}
        />
      )}
      {tools && (
        <ToggleButton
          on={tools.open}
          onClick={tools.onToggle}
          label="Tools"
          title={tools.open ? 'Hide the tools panel' : `Show ${tools.showLabel}`}
          shortcut={HOTKEYS.toggleTools.label}
          icon={<RightPanelIcon filled={tools.open} />}
          fold={fold}
        />
      )}
    </>
  );
}

function ToggleButton({
  on,
  onClick,
  label,
  title,
  shortcut,
  icon,
  fold,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  title: string;
  shortcut: string;
  icon: React.ReactNode;
  fold: { label: string; kbd: string };
}) {
  return (
    <Tip label={title} shortcut={shortcut}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={on}
        className={cn(
          'flex h-7 flex-shrink-0 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium transition-colors',
          on ? 'bg-muted/70 text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
        )}
      >
        {icon}
        <span className={fold.label}>{label}</span>
        <Kbd aria-hidden className={fold.kbd}>
          {shortcut}
        </Kbd>
      </button>
    </Tip>
  );
}

function BottomPanelIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 15h18" />
      {filled && <path d="M3 15h18v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="currentColor" />}
    </svg>
  );
}

function RightPanelIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
      {filled && <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4z" fill="currentColor" />}
    </svg>
  );
}

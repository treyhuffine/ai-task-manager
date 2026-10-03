'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { HOTKEYS } from '@/constants/commands';
import { useDesktopApp } from '@/hooks/use-desktop-app';
import { goBack, goForward, useHistoryNavigation } from '@/lib/client/history-navigation';
import { cn } from '@/lib/utils';

/**
 * Back and Forward, in the desktop app only: a browser has its own. They sit
 * at the left of the title bar, after the window controls, where a Mac app
 * puts them. Dimmed when there's nowhere to go. ⌘[ and ⌘] do the same
 * (`DesktopChrome`), and so do a mouse's side buttons.
 */
export function DesktopNavButtons({ className }: { className?: string }) {
  const desktop = useDesktopApp();
  const { canGoBack, canGoForward } = useHistoryNavigation();
  if (!desktop) return null;
  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      <NavButton label="Back" hotkey={HOTKEYS.navigateBack.label} disabled={!canGoBack} onClick={goBack}>
        <ArrowLeft size={14} />
      </NavButton>
      <NavButton label="Forward" hotkey={HOTKEYS.navigateForward.label} disabled={!canGoForward} onClick={goForward}>
        <ArrowRight size={14} />
      </NavButton>
    </div>
  );
}

function NavButton({
  label,
  hotkey,
  disabled,
  onClick,
  children,
}: {
  label: string;
  hotkey: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={`${label} (${hotkey})`}
      className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
    >
      {children}
    </button>
  );
}

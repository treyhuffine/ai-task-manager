"use client";

import { Calendar as CalendarIcon } from 'lucide-react';
import { openSettings } from '@/components/settings/settings-store';

/** What the calendar shows until one is connected. */
export function CalendarConnectPrompt({ onConnect }: { onConnect?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
      <CalendarIcon size={24} className="text-muted-foreground/30" />
      <div>
        <p className="text-sm font-medium text-foreground">Connect your calendar</p>
        <p className="text-xs text-muted-foreground mt-1">
          See your day here and let the deck plan around it
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          onConnect?.();
          openSettings('plugins');
        }}
        className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
      >
        Open connector settings
      </button>
    </div>
  );
}

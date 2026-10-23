'use client';

import { Moon, Sun } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useClientTheme } from '@/lib/client/theme';

/** Shared appearance control. It never reads or writes a Home's server settings. */
export function ThemeSettings() {
  const { theme, toggleTheme } = useClientTheme();
  const isDark = theme === 'dark';
  return <section className="space-y-2">
    <h3 className="text-[12px] font-medium text-foreground">Theme</h3>
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-background p-3">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
          {isDark ? <Moon size={16} className="text-primary" /> : <Sun size={16} className="text-primary" />}
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Dark mode</p>
          <p className="text-[11px] text-muted-foreground/60">Switch between light and dark themes for the whole app.</p>
        </div>
      </div>
      <Switch checked={isDark} onCheckedChange={toggleTheme} aria-label="Dark mode" />
    </label>
  </section>;
}

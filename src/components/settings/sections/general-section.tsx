'use client';

import { useEffect, useMemo, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useDashboard } from '@/contexts/dashboard-context';
import { useUserState, useUpdateUserState } from '@/hooks/use-user-state';
import {
  useEditorPreference,
  EDITOR_CHOICE_LABELS,
  EDITOR_CHOICES,
  type EditorChoice,
} from '@/lib/client/editor-preference';
import { useTranscriptDensity, type TranscriptDensity } from '@/lib/client/transcript-density';

const DEFAULT_START = '09:00';
const DEFAULT_END = '18:00';

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function allTimezones(): string[] {
  try {
    // Intl.supportedValuesOf is available in modern browsers + Node 18+.
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    const zones = fn ? fn('timeZone') : [];
    if (zones.length) return zones;
  } catch {
    // fall through to the minimal list
  }
  return ['UTC', browserTimezone()];
}

/**
 * General preferences: theme, timezone, working hours (the deck's planning
 * window), and display/editor preferences. Theme lives in dashboard context;
 * timezone + working hours persist to user_state; chat density + editor are
 * per-browser (localStorage).
 */
export function GeneralSection() {
  const { theme, toggleTheme } = useDashboard();
  const isDark = theme === 'dark';
  const { data: userState } = useUserState();
  const update = useUpdateUserState();

  const [start, setStart] = useState(DEFAULT_START);
  const [end, setEnd] = useState(DEFAULT_END);
  useEffect(() => {
    if (!userState) return;
    setStart(userState.workdayStart ?? DEFAULT_START);
    setEnd(userState.workdayEnd ?? DEFAULT_END);
  }, [userState?.workdayStart, userState?.workdayEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  const browserTz = useMemo(browserTimezone, []);
  const zones = useMemo(allTimezones, []);
  const effectiveTz = userState?.timezone ?? browserTz;
  const usingBrowserDefault = userState?.timezone == null;
  // Guarantee the effective zone is selectable even if it's not in the list.
  const zoneOptions = useMemo(
    () => (zones.includes(effectiveTz) ? zones : [effectiveTz, ...zones]),
    [zones, effectiveTz],
  );

  const { choice, customCommand, setChoice, setCustomCommand } = useEditorPreference();
  const { density, setDensity } = useTranscriptDensity();

  return (
    <div className="space-y-6">
      {/* Theme */}
      <section className="space-y-2">
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
      </section>

      {/* Timezone */}
      <section className="space-y-2">
        <h3 className="text-[12px] font-medium text-foreground">Timezone</h3>
        <p className="text-[11px] text-muted-foreground/85">
          Used with your working hours to plan the day in your local time.
        </p>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-3">
          <select
            value={effectiveTz}
            onChange={(e) => update.mutate({ timezone: e.target.value })}
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {zoneOptions.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          {usingBrowserDefault ? (
            <span className="text-[11px] text-muted-foreground/60">Browser default</span>
          ) : (
            <button
              type="button"
              onClick={() => update.mutate({ timezone: null })}
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              Reset to browser ({browserTz.replace(/_/g, ' ')})
            </button>
          )}
        </div>
      </section>

      {/* Working hours */}
      <section className="space-y-2">
        <h3 className="text-[12px] font-medium text-foreground">Working hours</h3>
        <p className="text-[11px] text-muted-foreground/85">
          The window your deck plans around, used to size the day and pace proactive work.
        </p>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
          <TimeField label="Start" value={start} onChange={(v) => { setStart(v); update.mutate({ workdayStart: v }); }} />
          <span className="mt-4 text-muted-foreground">-</span>
          <TimeField label="End" value={end} onChange={(v) => { setEnd(v); update.mutate({ workdayEnd: v }); }} />
        </div>
      </section>

      {/* Chat density */}
      <section className="space-y-2">
        <h3 className="text-[12px] font-medium text-foreground">Chat density</h3>
        <div className="space-y-2 rounded-lg border border-border bg-background p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-foreground">Transcript</span>
            <select
              value={density}
              onChange={(e) => setDensity(e.target.value as TranscriptDensity)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="condensed">Condensed</option>
              <option value="full">Full feed</option>
            </select>
          </div>
          <p className="text-[11px] text-muted-foreground/85">
            {density === 'condensed'
              ? 'Completed turns collapse their thinking, tool calls, and intermediate messages into a summary. The live turn and final reply stay visible.'
              : 'Every event renders as its own row.'}
          </p>
        </div>
      </section>

      {/* Editor */}
      <section className="space-y-2">
        <h3 className="text-[12px] font-medium text-foreground">Editor</h3>
        <div className="space-y-2 rounded-lg border border-border bg-background p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-foreground">Open files in</span>
            <select
              value={choice}
              onChange={(e) => setChoice(e.target.value as EditorChoice)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {EDITOR_CHOICES.map((key) => (
                <option key={key} value={key}>
                  {EDITOR_CHOICE_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
          {choice === 'custom' && (
            <input
              type="text"
              value={customCommand}
              onChange={(e) => setCustomCommand(e.target.value)}
              placeholder="nvim {file}"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-ring"
            />
          )}
          <p className="text-[11px] text-muted-foreground/85">
            {choice === 'custom'
              ? 'Runs on the host machine. Placeholders: {file}, {line}, {column}, {dir}.'
              : 'Used when you click “Open in editor” on a file or worktree. This preference is saved on this browser.'}
          </p>
        </div>
      </section>
    </div>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </label>
  );
}

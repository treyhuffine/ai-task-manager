'use client';

import { useEffect, useMemo, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useDashboard } from '@/contexts/dashboard-context';
import { useUserState, useUpdateUserState } from '@/hooks/use-user-state';
import { useMorningDeck, useUpdateMorningDeck } from '@/hooks/use-morning-deck';
import { useStreamAutonomy, useSetStreamAutonomy } from '@/hooks/use-stream';
import type { StreamAutomationMode } from '@/lib/api/stream';
import {
  useEditorPreference,
  EDITOR_CHOICE_LABELS,
  EDITOR_CHOICES,
  type EditorChoice,
} from '@/lib/client/editor-preference';
import { useTranscriptDensity, type TranscriptDensity } from '@/lib/client/transcript-density';

const DEFAULT_START = '09:00';
const DEFAULT_END = '18:00';

/** The single capture-triage control (no per-disposition toggle wall). */
const AUTOMATION_MODES: Array<{ id: StreamAutomationMode; label: string; description: string }> = [
  {
    id: 'handle_obvious',
    label: 'Let it handle the obvious',
    description: 'Applies what you have delegated, suggests the rest. The digest shows everything.',
  },
  {
    id: 'review_everything',
    label: 'Review everything',
    description: 'Triage still runs, but every outcome waits for your call.',
  },
  {
    id: 'manual_only',
    label: 'Manual only',
    description: 'No automatic triage. It runs only when you tap Triage.',
  },
];

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

  const { data: morning } = useMorningDeck();
  const updateMorning = useUpdateMorningDeck();
  const { data: autonomyState } = useStreamAutonomy();
  const setAutonomy = useSetStreamAutonomy();
  const [morningTime, setMorningTime] = useState('04:00');
  useEffect(() => {
    if (morning) setMorningTime(morning.time);
  }, [morning?.time]); // eslint-disable-line react-hooks/exhaustive-deps
  const morningEnabled = morning?.enabled ?? false;

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

      {/* Daily deck refresh */}
      <section className="space-y-2">
        <h3 className="text-[12px] font-medium text-foreground">Daily deck refresh</h3>
        <p className="text-[11px] text-muted-foreground/85">
          Prepares tomorrow&apos;s deck overnight so it&apos;s ready before you open the app. Your deck is
          always generated the first time you open it each day regardless.
        </p>
        <div className="space-y-3 rounded-lg border border-border bg-background p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-foreground">Refresh each morning</span>
            <Switch
              checked={morningEnabled}
              onCheckedChange={(next) => updateMorning.mutate({ enabled: next })}
              aria-label="Refresh the deck each morning"
            />
          </div>
          {morningEnabled && (
            <TimeField
              label="Refresh at"
              value={morningTime}
              onChange={(v) => { setMorningTime(v); updateMorning.mutate({ time: v }); }}
            />
          )}
        </div>
      </section>

      {/* Stream triage automation */}
      <section className="space-y-2">
        <h3 className="text-[12px] font-medium text-foreground">Capture triage</h3>
        <p className="text-[11px] text-muted-foreground/85">
          How much the assistant handles on its own when you capture thoughts. It earns more
          autonomy over time by asking, and everything it does can be undone in one tap.
        </p>
        <div className="space-y-1 rounded-lg border border-border bg-background p-3">
          {AUTOMATION_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setAutonomy.mutate({ mode: m.id })}
              className={`w-full flex items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                autonomyState?.mode === m.id ? 'bg-primary/10' : 'hover:bg-muted'
              }`}
            >
              <span
                className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                  autonomyState?.mode === m.id ? 'bg-primary' : 'bg-muted-foreground/30'
                }`}
              />
              <span className="min-w-0">
                <span className="block text-sm text-foreground">{m.label}</span>
                <span className="block text-[11px] text-muted-foreground/85">{m.description}</span>
              </span>
            </button>
          ))}
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

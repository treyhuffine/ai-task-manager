'use client';

/**
 * The heartbeat's settings and status. One component in two places: Settings
 * > Heartbeat (full) and the deck chip's sheet (compact), so they can't drift.
 * Every change saves as it's made through update_heartbeat.
 * See docs/heartbeat-spec.md §7.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Play } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { RunsOnPicker } from '@/components/triggers/runs-on-picker';
import { closeSettings } from '@/components/settings/settings-store';
import { useCheckInNow, useHeartbeat, useUpdateHeartbeat, type HeartbeatUpdate } from '@/hooks/use-heartbeat';
import { useOrchestratorName, useUserState } from '@/hooks/use-user-state';
import {
  DEFAULT_HEARTBEAT_INSTRUCTIONS,
  HEARTBEAT_LIMITED_HOURS_END,
  HEARTBEAT_LIMITED_HOURS_START,
  MIN_HEARTBEAT_INTERVAL_SECONDS,
} from '@/lib/heartbeat/constants';
import { INTERVAL_SECONDS_UNIT, INTERVAL_UNITS, intervalUnitFor } from '@/lib/scheduler/frequency';
import { describeHeartbeat, formatCheckInTime } from '@/lib/heartbeat/status';
import type { HeartbeatCheckIn, HeartbeatConfig } from '@/lib/heartbeat/types';
import { cn } from '@/lib/utils';
import { APP_NAME } from '@/constants/app';
import { AwakeNote } from '@/components/triggers/awake-note';

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const SELECT_CLASS = 'rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring';

/** The hard limits, in the words the user sees. Mirrors HEARTBEAT_GROUND_RULES. */
const GROUND_RULES = [
  'Never deletes anything',
  `Never sends, posts, or shares anything outside ${APP_NAME}`,
  'Never completes a task for you',
  'Starts agent work only when your instructions say to',
  'Stays quiet when nothing needs you',
];

/**
 * `onNavigate` closes whatever holds the panel before a link leaves it: the
 * settings modal by default, the deck chip's sheet when opened from there.
 */
export function HeartbeatSettings({
  compact = false,
  onNavigate = closeSettings,
}: {
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const { data: config, isLoading, error } = useHeartbeat();

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading the heartbeat…</p>;
  }
  if (!config) {
    return (
      <p className="text-sm text-destructive">
        Couldn&apos;t load the heartbeat{error ? `: ${(error as Error).message}` : '.'}
      </p>
    );
  }
  return <HeartbeatSettingsBody config={config} compact={compact} onNavigate={onNavigate} />;
}

function HeartbeatSettingsBody({
  config,
  compact,
  onNavigate,
}: {
  config: HeartbeatConfig;
  compact: boolean;
  onNavigate: () => void;
}) {
  const update = useUpdateHeartbeat();
  const checkIn = useCheckInNow();
  const { data: userState } = useUserState();
  const assistant = useOrchestratorName();
  const userTz = userState?.timezone || browserTimezone();
  const status = describeHeartbeat(config, new Date(), assistant);

  // Hours are shown and edited in the user's own timezone. Whenever the user
  // touches the schedule, bring the heartbeat's timezone along with them.
  const save = (patch: HeartbeatUpdate) => {
    const touchesSchedule =
      patch.enabled === true ||
      patch.intervalSeconds !== undefined ||
      patch.activeHoursStart !== undefined ||
      patch.activeHoursEnd !== undefined;
    if (touchesSchedule && config.timezone !== userTz) patch = { ...patch, timezone: userTz };
    update.mutate(patch);
  };

  const anyTime = config.activeHoursStart === null || config.activeHoursEnd === null;

  return (
    <div className="space-y-5">
      {/* On/off + status */}
      <section className="space-y-2">
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-background p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Heartbeat</p>
            <p className="text-[11px] text-muted-foreground/85">{status.detail}</p>
            {config.enabled && <AwakeNote lead="Checks in" />}
          </div>
          <Switch
            checked={config.enabled}
            onCheckedChange={(enabled) => save({ enabled })}
            aria-label="Heartbeat"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => checkIn.mutate(config.triggerId)}
            disabled={config.running || checkIn.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12px] hover:bg-muted disabled:opacity-50"
          >
            {config.running || checkIn.isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Play size={12} />
            )}
            {config.running || checkIn.isPending ? 'Checking in…' : 'Check in now'}
          </button>
        </div>
      </section>

      <RecentCheckIns config={config} onNavigate={onNavigate} />

      {/* Schedule */}
      <section className="space-y-2">
        <h3 className="text-[12px] font-medium text-foreground">Schedule</h3>
        <div className="space-y-3 rounded-lg border border-border bg-background p-3">
          <IntervalInput seconds={config.intervalSeconds} onCommit={(intervalSeconds) => save({ intervalSeconds })} />
          {/* The container is this row alone, because the model picker below
              can't have one above it (see LauncherPopoverContent). */}
          <div className="@container flex flex-wrap items-center gap-2">
            <span className="w-14 shrink-0 text-[12px] text-muted-foreground">Hours</span>
            <select
              value={anyTime ? 'any' : 'window'}
              onChange={(e) =>
                save(
                  e.target.value === 'any'
                    ? { activeHoursStart: null, activeHoursEnd: null }
                    : {
                        activeHoursStart: HEARTBEAT_LIMITED_HOURS_START,
                        activeHoursEnd: HEARTBEAT_LIMITED_HOURS_END,
                      },
                )
              }
              className={SELECT_CLASS}
              aria-label="When it may check in"
            >
              <option value="any">24/7</option>
              <option value="window">Between</option>
            </select>
            {!anyTime && (
              // One unit, so a narrow panel wraps the pair together. Below a
              // medium container it takes its own row and the inputs share it.
              <span className="flex w-full min-w-0 items-center gap-2 @md:w-auto">
                <TimeInput
                  label="From"
                  value={config.activeHoursStart ?? HEARTBEAT_LIMITED_HOURS_START}
                  onCommit={(v) => v !== config.activeHoursEnd && save({ activeHoursStart: v })}
                />
                <span className="text-[12px] text-muted-foreground">and</span>
                <TimeInput
                  label="To"
                  value={config.activeHoursEnd ?? HEARTBEAT_LIMITED_HOURS_END}
                  onCommit={(v) => v !== config.activeHoursStart && save({ activeHoursEnd: v })}
                />
              </span>
            )}
          </div>
          {!anyTime && config.timezone && config.timezone !== userTz && (
            <p className="text-[11px] text-muted-foreground/85">
              These hours are in {config.timezone.replace(/_/g, ' ')}.{' '}
              <button
                type="button"
                onClick={() => update.mutate({ timezone: userTz })}
                className="font-medium text-foreground hover:underline"
              >
                Use {userTz.replace(/_/g, ' ')}
              </button>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-14 shrink-0 text-[12px] text-muted-foreground">Runs on</span>
            <RunsOnPicker
              value={{ provider: config.provider, model: config.model, effort: config.effort, serviceTier: config.serviceTier }}
              onChange={(change) => save(change)}
              disabled={update.isPending}
            />
          </div>
        </div>
      </section>

      <InstructionsEditor config={config} compact={compact} onSave={save} saving={update.isPending} />

      <details className="group text-[11px] text-muted-foreground">
        <summary className="cursor-pointer select-none hover:text-foreground">What it always follows</summary>
        <ul className="mt-2 space-y-1 pl-4">
          {GROUND_RULES.map((rule) => (
            <li key={rule} className="list-disc">{rule}</li>
          ))}
        </ul>
        <p className="mt-2">
          Every change it makes is listed under Changes and can be undone from the task or note&apos;s history.
        </p>
      </details>
    </div>
  );
}

/**
 * What the check-ins have been doing. They run in the background and only
 * important findings become messages, so this is where to look for the rest.
 */
function RecentCheckIns({ config, onNavigate }: { config: HeartbeatConfig; onNavigate: () => void }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-medium text-foreground">Recent check-ins</h3>
        <Link
          href={`/triggers/${config.triggerId}`}
          onClick={onNavigate}
          className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          History
        </Link>
      </div>
      {config.recentCheckIns.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/85">None yet.</p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border bg-background">
          {config.recentCheckIns.map((checkIn) => (
            <CheckInRow key={checkIn.runId} checkIn={checkIn} onNavigate={onNavigate} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CheckInRow({ checkIn, onNavigate }: { checkIn: HeartbeatCheckIn; onNavigate: () => void }) {
  const text = checkIn.status === 'failed' ? (checkIn.errorMessage ?? 'Failed') : checkIn.status === 'cancelled' ? 'Stopped' : (checkIn.summary ?? 'Finished');
  const body = (
    <>
      <span className="w-[4.5rem] shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatCheckInTime(checkIn.at)}</span>
      <span className={cn('min-w-0 flex-1 truncate text-[12px]', checkIn.status === 'failed' ? 'text-destructive' : 'text-foreground')}>{text}</span>
    </>
  );
  return (
    <li className="flex items-center gap-2 pr-2">
      {checkIn.chatSessionId ? (
        <Link
          href={`/?session=${checkIn.chatSessionId}`}
          onClick={onNavigate}
          aria-label={`Open the check-in from ${formatCheckInTime(checkIn.at)}: ${text}`}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 hover:bg-muted/50"
        >
          {body}
        </Link>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5">{body}</span>
      )}
      {checkIn.changedCount > 0 && (
        <Link
          href={`/runs/${checkIn.runId}`}
          onClick={onNavigate}
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Changes ({checkIn.changedCount})
        </Link>
      )}
    </li>
  );
}

/**
 * "Every [30] [minutes]", stored as seconds. The number saves when it's
 * finished (on blur or Enter) and the unit as it's picked. A number under the
 * floor stays in the box unsaved, so typing 2 and then picking hours gets 2 hours.
 */
function IntervalInput({ seconds, onCommit }: { seconds: number; onCommit: (seconds: number) => void }) {
  const [unit, setUnit] = useState(() => intervalUnitFor(seconds));
  const [draft, setDraft] = useState(String(seconds / unit));
  // Follow a saved value that changed elsewhere (render-time sync, not an effect).
  // A save from here counts as synced, so 120 minutes doesn't jump to 2 hours.
  const [synced, setSynced] = useState(seconds);
  // "4" is on its way to "45", so only speak up once they've left the box.
  const [left, setLeft] = useState(false);
  if (seconds !== synced) {
    const nextUnit = intervalUnitFor(seconds);
    setSynced(seconds);
    setUnit(nextUnit);
    setDraft(String(seconds / nextUnit));
  }

  const typed = Number(draft);
  const typedSeconds = Math.round(typed * unit);
  const tooShort = draft !== '' && typedSeconds > 0 && typedSeconds < MIN_HEARTBEAT_INTERVAL_SECONDS;
  const units = unit === INTERVAL_SECONDS_UNIT.seconds ? [INTERVAL_SECONDS_UNIT, ...INTERVAL_UNITS] : INTERVAL_UNITS;

  const saveInterval = (next: number) => {
    setSynced(next);
    onCommit(next);
  };

  const commit = () => {
    setLeft(true);
    if (tooShort) return;
    if (typedSeconds >= MIN_HEARTBEAT_INTERVAL_SECONDS && typedSeconds !== seconds) saveInterval(typedSeconds);
    else setDraft(String(seconds / unit));
  };

  const pickUnit = (nextUnit: number) => {
    const count = typed > 0 ? typed : seconds / unit;
    const next = Math.max(MIN_HEARTBEAT_INTERVAL_SECONDS, Math.round(count * nextUnit));
    setUnit(nextUnit);
    setDraft(String(next / nextUnit));
    if (next !== seconds) saveInterval(next);
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-14 shrink-0 text-[12px] text-muted-foreground">Every</span>
        <input
          type="number"
          min={1}
          step="any"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setLeft(false);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          aria-label="How often it checks in"
          aria-invalid={tooShort && left}
          className="w-16 rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <select value={unit} onChange={(e) => pickUnit(Number(e.target.value))} aria-label="Unit" className={SELECT_CLASS}>
          {units.map((u) => (
            <option key={u.label} value={u.seconds}>{typed === 1 ? u.label.slice(0, -1) : u.label}</option>
          ))}
        </select>
      </div>
      {tooShort && left && (
        <p role="alert" className="pl-16 text-[11px] text-destructive">
          At least {MIN_HEARTBEAT_INTERVAL_SECONDS / 60} minutes. This one isn&apos;t saved.
        </p>
      )}
    </div>
  );
}

/** A time input that saves when a complete time is entered, not on every keystroke. */
function TimeInput({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  // Follow a saved value that changed underneath (render-time sync, not an effect).
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }
  return (
    <input
      type="time"
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (/^\d{2}:\d{2}$/.test(draft) && draft !== value) onCommit(draft);
        else setDraft(value);
      }}
      className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring @md:flex-none"
    />
  );
}

function InstructionsEditor({
  config,
  compact,
  onSave,
  saving,
}: {
  config: HeartbeatConfig;
  compact: boolean;
  onSave: (patch: HeartbeatUpdate) => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(!compact);
  const [draft, setDraft] = useState(config.instructions);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [synced, setSynced] = useState(config.instructions);

  // Follow saves from elsewhere (another tab, an agent, Reset) unless the user
  // is mid-edit here: never clobber text they are typing. Render-time sync.
  if (!editing && config.instructions !== synced) {
    setSynced(config.instructions);
    setDraft(config.instructions);
  }

  // "Saved" fades after a moment.
  useEffect(() => {
    if (savedAt === null) return;
    const t = setTimeout(() => setSavedAt(null), 2000);
    return () => clearTimeout(t);
  }, [savedAt]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (!next) {
      setDraft(config.instructions); // empty instructions are not allowed; put them back
      return;
    }
    if (next === config.instructions.trim()) return;
    onSave({ instructions: next });
    setSavedAt(Date.now());
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[12px] font-medium text-muted-foreground hover:text-foreground"
      >
        Edit instructions
      </button>
    );
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-medium text-foreground">Instructions</h3>
        <span
          className={cn(
            'text-[11px] text-muted-foreground transition-opacity',
            savedAt !== null && !saving ? 'opacity-100' : 'opacity-0',
          )}
          aria-live="polite"
        >
          Saved
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground/85">
        What to do, and when. Each check-in knows the time and what earlier ones did, so you can write things like &ldquo;once each morning&rdquo;.
      </p>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setEditing(true)}
        onBlur={commit}
        rows={compact ? 6 : 9}
        className="max-h-[50vh] overflow-y-auto font-sans text-sm"
        aria-label="Heartbeat instructions"
      />
      <button
        type="button"
        onClick={() => {
          setDraft(DEFAULT_HEARTBEAT_INSTRUCTIONS);
          onSave({ resetInstructions: true });
          setSavedAt(Date.now());
        }}
        disabled={config.instructionsAreDefault}
        className="text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
      >
        Reset to default
      </button>
    </section>
  );
}

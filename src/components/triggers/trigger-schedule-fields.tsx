'use client';

import { useState } from 'react';
import type { TriggerRecord } from '@/db/types';
import { validateCronExpression } from '@/lib/scheduler/cron';
import { frequencyToTrigger, type FrequencyChoice, type FrequencyKind, type Weekday } from '@/lib/scheduler/frequency';

export type ScheduleChoice = FrequencyChoice & { timezone: string };

const FREQUENCIES: { value: FrequencyKind; label: string; kind: TriggerRecord['kind'] }[] = [
  { value: 'manual', label: 'Manual: Run now only', kind: 'manual' },
  { value: 'once', label: 'One time', kind: 'at' },
  { value: 'hourly', label: 'Hourly', kind: 'cron' },
  { value: 'daily', label: 'Daily', kind: 'cron' },
  { value: 'weekdays', label: 'Weekdays (Monday to Friday)', kind: 'cron' },
  { value: 'weekly', label: 'Weekly', kind: 'cron' },
  { value: 'monthly', label: 'Monthly', kind: 'cron' },
  { value: 'every', label: 'Every interval', kind: 'every' },
  { value: 'webhook', label: 'Webhook', kind: 'webhook' },
  { value: 'custom', label: 'Custom cron', kind: 'cron' },
];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function scheduleChoiceResult(value: ScheduleChoice) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value.timezone }).format();
    const schedule = frequencyToTrigger(value);
    let preview: string[] = [];
    if (schedule.kind === 'cron') {
      const validation = validateCronExpression(schedule.cronExpression!, value.timezone);
      if (!validation.valid) throw new Error(validation.error);
      preview = validation.preview ?? [];
    }
    if (schedule.kind === 'at') {
      if (new Date(schedule.runAt!).getTime() <= Date.now()) {
        throw new Error('Choose a future date and time.');
      }
      preview = [schedule.runAt!];
    }
    return { schedule, preview, error: null };
  } catch (error) {
    return { schedule: null, preview: [], error: error instanceof Error ? error.message : 'Invalid schedule.' };
  }
}

/** The trigger kinds a schedule can switch between once it exists (update_trigger). */
export const EDITABLE_KINDS: readonly TriggerRecord['kind'][] = ['manual', 'at', 'every', 'cron'];

/** Shared by creation and editing. Native date inputs provide the calendar. */
export function TriggerScheduleFields({ value, onChange, kinds, disabled = false }: {
  value: ScheduleChoice;
  onChange: (value: ScheduleChoice) => void;
  /** The trigger kinds on offer. All of them when unset. */
  kinds?: readonly TriggerRecord['kind'][];
  disabled?: boolean;
}) {
  const patch = (change: Partial<ScheduleChoice>) => onChange({ ...value, ...change });
  const result = scheduleChoiceResult(value);
  const needsTime = ['once', 'daily', 'weekdays', 'weekly', 'monthly'].includes(value.kind);
  const scheduled = value.kind !== 'manual' && value.kind !== 'webhook';

  return (
    <fieldset disabled={disabled} className="space-y-3">
      <label className="block space-y-1 text-[12px] font-medium">
        <span>Frequency</span>
        <select value={value.kind} onChange={(e) => patch({ kind: e.target.value as FrequencyKind })} className={inputCls}>
          {FREQUENCIES.filter((option) => !kinds || kinds.includes(option.kind)).map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap items-end gap-3">
        {value.kind === 'once' && (
          <label className="min-w-0 flex-1 space-y-1 text-[12px] font-medium">
            <span>Date</span>
            <input type="date" value={value.date ?? ''} onChange={(e) => patch({ date: e.target.value })} required className={inputCls} />
          </label>
        )}
        {value.kind === 'weekly' && (
          <DaysField
            days={value.weekdays?.length ? value.weekdays : [value.weekday ?? 1]}
            onChange={(days) => patch({ weekdays: days, weekday: days[0] })}
          />
        )}
        {value.kind === 'monthly' && (
          <label className="space-y-1 text-[12px] font-medium">
            <span>Day of month</span>
            <input type="number" min={1} max={28} value={value.dayOfMonth ?? 1} onChange={(e) => patch({ dayOfMonth: Number(e.target.value) })} required className={`${inputCls} max-w-24`} />
          </label>
        )}
        {needsTime && (
          <label className="space-y-1 text-[12px] font-medium">
            <span>Time</span>
            <input type="time" value={value.time ?? '09:00'} onChange={(e) => patch({ time: e.target.value })} required className={inputCls} />
          </label>
        )}
      </div>
      {value.kind === 'monthly' && <p className="text-[11px] text-muted-foreground">Days 1 to 28 run every month, including February.</p>}
      {value.kind === 'every' && (
        <IntervalField seconds={value.intervalSeconds ?? 3600} onChange={(intervalSeconds) => patch({ intervalSeconds })} />
      )}
      {value.kind === 'custom' && (
        <label className="block space-y-1 text-[12px] font-medium">
          <span>Cron expression</span>
          <input type="text" value={value.cronExpression ?? '0 9 * * *'} onChange={(e) => patch({ cronExpression: e.target.value })} placeholder="0 9 * * 1-5" required className={`${inputCls} font-mono`} />
          <span className="block text-[11px] font-normal text-muted-foreground">Minute, hour, day of month, month, day of week</span>
        </label>
      )}
      {scheduled && (
        <label className="block space-y-1 text-[12px] font-medium">
          <span>Timezone</span>
          <input type="text" value={value.timezone} onChange={(e) => patch({ timezone: e.target.value })} placeholder="America/Denver" required className={inputCls} />
        </label>
      )}
      {value.kind === 'manual' && <p className="text-[11px] text-muted-foreground">Use Run now whenever you need it.</p>}
      {value.kind === 'webhook' && <p className="text-[11px] text-muted-foreground">A public ID and signing secret are generated on save. The secret is shown once.</p>}
      {result.error && <p role="alert" className="text-[12px] text-destructive">{result.error}</p>}
      {result.preview.length > 0 && (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-[12px]">
          <p className="mb-1 font-medium">{value.kind === 'once' ? 'Runs once' : 'Next runs'}</p>
          <ul className="space-y-1 text-muted-foreground">
            {result.preview.map((at) => <li key={at}>{new Date(at).toLocaleString(undefined, {
              timeZone: value.timezone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
              hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
            })}</li>)}
          </ul>
        </div>
      )}
    </fieldset>
  );
}

/** The days a weekly job runs, as toggles from Monday. At least one stays on. */
function DaysField({ days, onChange }: { days: Weekday[]; onChange: (days: Weekday[]) => void }) {
  const toggle = (day: Weekday) => {
    const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
    if (next.length > 0) onChange([...next].sort((a, b) => a - b));
  };
  return (
    <div role="group" aria-label="Days" className="space-y-1 text-[12px] font-medium">
      <span className="block">Days</span>
      <div className="flex flex-wrap gap-1">
        {([1, 2, 3, 4, 5, 6, 0] as Weekday[]).map((day) => {
          const on = days.includes(day);
          return (
            <button
              key={day}
              type="button"
              aria-pressed={on}
              aria-label={WEEKDAYS[day]}
              onClick={() => toggle(day)}
              className={`h-9 w-11 rounded-md border text-[12px] font-medium transition-colors ${
                on ? 'border-primary bg-primary/15 text-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              {WEEKDAYS[day].slice(0, 3)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const UNITS = [
  { label: 'minutes', seconds: 60 },
  { label: 'hours', seconds: 3600 },
  { label: 'days', seconds: 86_400 },
] as const;

/** The largest unit the interval is a whole number of, so 7200 reads as 2 hours. */
function unitFor(seconds: number): number {
  const unit = [...UNITS].reverse().find((u) => seconds > 0 && seconds % u.seconds === 0);
  return unit?.seconds ?? 1;
}

/**
 * "Every [n] [minutes|hours|days]", stored as seconds. The unit is chosen once
 * from the saved interval and then follows the select, so typing 120 minutes
 * doesn't jump to 2 hours under the caret. An interval that isn't whole
 * minutes (only the API makes one) offers seconds too.
 */
function IntervalField({ seconds, onChange }: { seconds: number; onChange: (seconds: number) => void }) {
  const [unit, setUnit] = useState(() => unitFor(seconds));
  const units = unit === 1 ? [{ label: 'seconds', seconds: 1 }, ...UNITS] : UNITS;
  return (
    <div className="flex items-end gap-2">
      <label className="min-w-0 flex-1 space-y-1 text-[12px] font-medium">
        <span>Every</span>
        <input
          type="number"
          min={1}
          step={1}
          value={Number.isFinite(seconds / unit) ? seconds / unit : ''}
          onChange={(e) => onChange(Math.round(Number(e.target.value) * unit))}
          required
          className={inputCls}
        />
      </label>
      <label className="space-y-1 text-[12px] font-medium">
        <span className="sr-only">Unit</span>
        <select
          aria-label="Unit"
          value={unit}
          onChange={(e) => {
            const next = Number(e.target.value);
            setUnit(next);
            onChange(Math.max(1, Math.round(seconds / unit)) * next);
          }}
          className={inputCls}
        >
          {units.map((u) => <option key={u.label} value={u.seconds}>{u.label}</option>)}
        </select>
      </label>
    </div>
  );
}

const inputCls = 'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

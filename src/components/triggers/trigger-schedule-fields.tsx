'use client';

import type { TriggerRecord } from '@/db/types';
import { validateCronExpression } from '@/lib/scheduler/cron';
import { frequencyToTrigger, type FrequencyChoice, type FrequencyKind, type Weekday } from '@/lib/scheduler/frequency';

export type ScheduleChoice = FrequencyChoice & { timezone: string };

const FREQUENCIES: { value: FrequencyKind; label: string; kind: TriggerRecord['kind'] }[] = [
  { value: 'manual', label: 'Manual: Run now only', kind: 'manual' },
  { value: 'once', label: 'One time', kind: 'at' },
  { value: 'hourly', label: 'Hourly', kind: 'cron' },
  { value: 'daily', label: 'Daily', kind: 'cron' },
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

/** Shared by creation and editing. Native date inputs provide the calendar. */
export function TriggerScheduleFields({ value, onChange, kind, disabled = false }: {
  value: ScheduleChoice;
  onChange: (value: ScheduleChoice) => void;
  /** Existing triggers keep their kind, matching update_trigger's contract. */
  kind?: TriggerRecord['kind'];
  disabled?: boolean;
}) {
  const patch = (change: Partial<ScheduleChoice>) => onChange({ ...value, ...change });
  const result = scheduleChoiceResult(value);
  const needsTime = ['once', 'daily', 'weekly', 'monthly'].includes(value.kind);
  const scheduled = value.kind !== 'manual' && value.kind !== 'webhook';

  return (
    <fieldset disabled={disabled} className="space-y-3">
      <label className="block space-y-1 text-[12px] font-medium">
        <span>Frequency</span>
        <select value={value.kind} onChange={(e) => patch({ kind: e.target.value as FrequencyKind })} className={inputCls}>
          {FREQUENCIES.filter((option) => !kind || option.kind === kind).map((option) => (
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
          <label className="space-y-1 text-[12px] font-medium">
            <span>Day of week</span>
            <select value={value.weekday ?? 1} onChange={(e) => patch({ weekday: Number(e.target.value) as Weekday })} className={inputCls}>
              {[1, 2, 3, 4, 5, 6, 0].map((day) => <option key={day} value={day}>{WEEKDAYS[day]}</option>)}
            </select>
          </label>
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
        <label className="block space-y-1 text-[12px] font-medium">
          <span>Interval (seconds)</span>
          <input type="number" min={1} step={1} value={value.intervalSeconds ?? 3600} onChange={(e) => patch({ intervalSeconds: Number(e.target.value) })} required className={inputCls} />
        </label>
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

const inputCls = 'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

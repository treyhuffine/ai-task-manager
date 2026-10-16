'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import type { TriggerRecord } from '@/db/types';
import { useUpdateTrigger } from '@/hooks/use-triggers';
import { describeFrequency, triggerToFrequency } from '@/lib/scheduler/frequency';
import { TriggerScheduleFields, scheduleChoiceResult, type ScheduleChoice } from './trigger-schedule-fields';

export function TriggerSchedule({ trigger }: { trigger: TriggerRecord }) {
  const [editing, setEditing] = useState(false);
  const scheduled = ['cron', 'at', 'every'].includes(trigger.kind);

  return (
    <section aria-label="Schedule" className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground">Schedule</h2>
        {scheduled && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] hover:bg-muted">
            <Pencil size={12} />
            Edit schedule
          </button>
        )}
      </div>
      {editing ? (
        <ScheduleForm trigger={trigger} onClose={() => setEditing(false)} />
      ) : (
        <div className="space-y-1 rounded-md border border-border bg-card p-3 text-sm">
          <p>{describeFrequency(trigger)}</p>
          {scheduled && <p className="text-[12px] text-muted-foreground">Timezone: {trigger.timezone ?? 'UTC'}</p>}
          {trigger.nextRunAt && (
            <p className="text-[12px] text-muted-foreground">
              {trigger.enabled ? 'Next run' : 'Scheduled time (paused)'}: {new Date(trigger.nextRunAt).toLocaleString(undefined, {
                timeZone: trigger.timezone ?? 'UTC', dateStyle: 'medium', timeStyle: 'short',
              })}
            </p>
          )}
          {trigger.kind === 'at' && !trigger.nextRunAt && <p className="text-[12px] text-muted-foreground">Finished. Edit the schedule to run again at a new time.</p>}
        </div>
      )}
    </section>
  );
}

function ScheduleForm({ trigger, onClose }: { trigger: TriggerRecord; onClose: () => void }) {
  const [value, setValue] = useState<ScheduleChoice>(() => ({
    time: '09:00', weekday: 1, dayOfMonth: 1,
    cronExpression: trigger.cronExpression ?? '0 9 * * *', intervalSeconds: 3600,
    ...triggerToFrequency(trigger), timezone: trigger.timezone ?? 'UTC',
  }));
  const update = useUpdateTrigger({ carriesInput: true });
  const result = scheduleChoiceResult(value);

  function save(e: React.FormEvent) {
    e.preventDefault();
    const schedule = scheduleChoiceResult(value).schedule;
    if (!schedule) return;
    // update_trigger keeps the kind and all unrelated settings intact.
    update.mutate({
      id: trigger.id,
      cronExpression: schedule.cronExpression,
      ...(schedule.runAt !== undefined ? { runAt: schedule.runAt } : {}),
      ...(schedule.intervalSeconds !== undefined ? { intervalSeconds: schedule.intervalSeconds } : {}),
      timezone: value.timezone,
    }, { onSuccess: onClose });
  }

  return (
    <form onSubmit={save} className="space-y-4 rounded-md border border-border bg-card p-4">
      <TriggerScheduleFields value={value} onChange={setValue} kind={trigger.kind} disabled={update.isPending} />
      {!trigger.enabled && <p className="text-[12px] text-muted-foreground">Saving keeps this trigger paused. Resume it when you want it to run.</p>}
      {update.error && <p role="alert" className="text-[12px] text-destructive">{update.error.message}</p>}
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onClose} disabled={update.isPending} className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">Cancel</button>
        <button type="submit" disabled={!result.schedule || update.isPending} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {update.isPending ? 'Saving…' : 'Save schedule'}
        </button>
      </div>
    </form>
  );
}

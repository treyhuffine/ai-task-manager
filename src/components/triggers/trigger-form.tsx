'use client';

/**
 * A schedule's whole form: name, description, message, where it runs, who
 * runs it, its timing and the advanced rules. Creates a schedule when given
 * none, and edits one when given it. Used by the Schedules window (beside the
 * schedule's builder chat), the /triggers/new page and the /triggers/<id>
 * page.
 *
 * Editing sends only what changed. The schedule can change underneath the
 * form while it's open (its builder chat, another screen), so each field
 * merges on its own: one the user hasn't touched takes the new value, one
 * they have keeps their edit (`rebase`).
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, FolderOpen, Save } from 'lucide-react';
import { APP_NAME } from '@/constants/app';
import type { TriggerConcurrencyPolicy, TriggerRecord, TriggerView } from '@/db/types';
import { useCreateTrigger, useUpdateTrigger } from '@/hooks/use-triggers';
import { useUserState } from '@/hooks/use-user-state';
import { useWorkspaces } from '@/hooks/use-workspaces';
import type { UpdateTriggerPayload } from '@/lib/api/triggers';
import { DEFAULT_HARNESS } from '@/lib/harness/registry';
import { frequencyToTrigger, triggerToFrequency } from '@/lib/scheduler/frequency';
import { lockedFieldsFor, RESERVED_TRIGGER_IDS } from '@/lib/triggers/reserved';
import { cn } from '@/lib/utils';
import { RunsOnPicker, type RunsOnValue } from './runs-on-picker';
import { EDITABLE_KINDS, TriggerScheduleFields, scheduleChoiceResult, type ScheduleChoice } from './trigger-schedule-fields';
import { TriggerTargetChat } from './trigger-target-chat';

export interface WebhookCredentials {
  publicId: string;
  secret: string;
}

export interface TriggerFormProps {
  /** The schedule to edit. Without one, the form creates a schedule. */
  trigger?: TriggerView;
  /** After a create. A webhook brings its credentials, shown only once. */
  onCreated?(trigger: TriggerRecord, webhook?: WebhookCredentials): void;
  /** Creating: the Cancel button. Editing discards in place instead. */
  onCancel?(): void;
}

interface Values {
  name: string;
  description: string;
  prompt: string;
  workspaceId: string | null;
  /** Null while creating means the user's default provider and model. */
  runsOn: RunsOnValue | null;
  schedule: ScheduleChoice;
  timeoutSeconds: number | null;
  concurrencyPolicy: TriggerConcurrencyPolicy;
  activeHoursStart: string;
  activeHoursEnd: string;
}

function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** Defaults every frequency's controls, so switching kinds starts somewhere sensible. */
const SCHEDULE_DEFAULTS = { time: '09:00', weekday: 1, dayOfMonth: 1, intervalSeconds: 3600 } as const;

function valuesFrom(trigger: TriggerView): Values {
  return {
    name: trigger.name,
    description: trigger.description ?? '',
    prompt: trigger.prompt,
    workspaceId: trigger.workspaceId,
    runsOn: { provider: trigger.provider, model: trigger.model, effort: trigger.effort, serviceTier: trigger.serviceTier ?? null },
    schedule: {
      ...SCHEDULE_DEFAULTS,
      cronExpression: trigger.cronExpression ?? '0 9 * * *',
      ...triggerToFrequency(trigger),
      // A manual job has no timezone yet. If it gets a time, it's the user's.
      timezone: trigger.timezone ?? browserTimezone(),
    },
    timeoutSeconds: trigger.timeoutSeconds,
    concurrencyPolicy: trigger.concurrencyPolicy,
    activeHoursStart: trigger.activeHoursStart ?? '',
    activeHoursEnd: trigger.activeHoursEnd ?? '',
  };
}

function newValues(): Values {
  return {
    name: '',
    description: '',
    prompt: '',
    workspaceId: null,
    runsOn: null,
    schedule: { ...SCHEDULE_DEFAULTS, kind: 'daily', cronExpression: '0 9 * * *', timezone: browserTimezone() },
    timeoutSeconds: null,
    concurrencyPolicy: 'coalesce_if_active',
    activeHoursStart: '',
    activeHoursEnd: '',
  };
}

/** Stable JSON: sorted keys, undefined dropped, so equal values always match. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

const same = (a: unknown, b: unknown) => stable(a) === stable(b);

/**
 * Two schedule choices are the same when they time the job the same way.
 * The controls carry spare values (the custom cron while Daily is picked,
 * the interval while Weekly is), which don't count.
 */
function sameSchedule(a: ScheduleChoice, b: ScheduleChoice): boolean {
  const meaning = (choice: ScheduleChoice) => {
    try {
      return stable({ ...frequencyToTrigger(choice), timezone: choice.timezone });
    } catch {
      return stable(choice);
    }
  };
  return meaning(a) === meaning(b);
}

function sameField<K extends keyof Values>(key: K, a: Values[K], b: Values[K]): boolean {
  return key === 'schedule' ? sameSchedule(a as ScheduleChoice, b as ScheduleChoice) : same(a, b);
}

/**
 * Merge a change that arrived while the form was open: each field the user
 * left as it was takes the new value, each one they edited keeps theirs.
 */
function rebase(base: Values, current: Values, next: Values): Values {
  const out = { ...current };
  for (const key of Object.keys(next) as (keyof Values)[]) {
    if (sameField(key, current[key], base[key])) (out as Record<keyof Values, unknown>)[key] = next[key];
  }
  return out;
}

/** The update_trigger patch from `base` to `next`: only what changed. */
function patchFor(trigger: TriggerView, base: Values, next: Values): UpdateTriggerPayload {
  const patch: UpdateTriggerPayload = {};
  if (next.name.trim() !== base.name.trim()) patch.name = next.name.trim();
  if (next.description.trim() !== base.description.trim()) patch.description = next.description.trim() || null;
  if (next.prompt.trim() !== base.prompt.trim()) patch.prompt = next.prompt.trim();
  if (next.workspaceId && next.workspaceId !== base.workspaceId) patch.workspaceId = next.workspaceId;

  const a = base.runsOn;
  const b = next.runsOn;
  if (b && a && !same(a, b)) {
    // A provider switch restates model and effort, or the server resets them.
    if (b.provider && b.provider !== a.provider) {
      patch.provider = b.provider;
      patch.model = b.model;
      patch.effort = b.effort;
    } else {
      if (b.model !== a.model) patch.model = b.model;
      if (b.effort !== a.effort) patch.effort = b.effort;
    }
    if ((b.serviceTier ?? null) !== (a.serviceTier ?? null)) patch.serviceTier = b.serviceTier ?? null;
  }

  if (!sameSchedule(next.schedule, base.schedule)) {
    const schedule = scheduleChoiceResult(next.schedule).schedule;
    if (schedule) {
      if (schedule.kind !== trigger.kind) patch.kind = schedule.kind;
      patch.cronExpression = schedule.cronExpression;
      if (schedule.runAt !== undefined) patch.runAt = schedule.runAt;
      if (schedule.intervalSeconds !== undefined) patch.intervalSeconds = schedule.intervalSeconds;
      patch.timezone = next.schedule.timezone;
    }
  }

  if (next.timeoutSeconds !== base.timeoutSeconds) patch.timeoutSeconds = next.timeoutSeconds;
  if (next.concurrencyPolicy !== base.concurrencyPolicy) patch.concurrencyPolicy = next.concurrencyPolicy;
  if (next.activeHoursStart !== base.activeHoursStart) patch.activeHoursStart = next.activeHoursStart || null;
  if (next.activeHoursEnd !== base.activeHoursEnd) patch.activeHoursEnd = next.activeHoursEnd || null;
  return patch;
}

export function TriggerForm({ trigger, onCreated, onCancel }: TriggerFormProps) {
  const createTrigger = useCreateTrigger();
  const updateTrigger = useUpdateTrigger({ carriesInput: true });
  const { data: workspaces } = useWorkspaces();
  const { data: userState } = useUserState();

  // `base` is the schedule as last loaded, `values` what the form shows.
  const [form, setForm] = useState(() => {
    const base = trigger ? valuesFrom(trigger) : newValues();
    return { base, values: base, signature: stable(base) };
  });
  // Merged while rendering, so the form never paints the old schedule.
  if (trigger) {
    const next = valuesFrom(trigger);
    const signature = stable(next);
    if (signature !== form.signature) {
      setForm({ base: next, values: rebase(form.base, form.values, next), signature });
    }
  }
  const { base, values } = form;
  const set = (change: Partial<Values>) => setForm((f) => ({ ...f, values: { ...f.values, ...change } }));

  // With only one agent there's nothing to choose.
  if (!trigger && workspaces?.length === 1 && !values.workspaceId) set({ workspaceId: workspaces[0].id });

  const locked = new Set(trigger ? lockedFieldsFor(trigger.id) : []);
  const isHeartbeat = trigger?.id === RESERVED_TRIGGER_IDS.heartbeat;
  const target = trigger?.targetKind ?? 'workspace';
  const kinds = !trigger ? undefined
    : trigger.kind === 'webhook' || locked.has('kind') ? [trigger.kind] : EDITABLE_KINDS;

  const runsOn: RunsOnValue = values.runsOn ?? {
    provider: userState?.defaultHarness ?? DEFAULT_HARNESS,
    model: userState?.defaultModel ?? null,
    effort: null,
    serviceTier: null,
  };

  const scheduleChanged = !sameSchedule(values.schedule, base.schedule);
  const scheduleResult = scheduleChoiceResult(values.schedule);
  const scheduleOk = !scheduleChanged && trigger ? true : !!scheduleResult.schedule;
  const patch = trigger ? patchFor(trigger, base, values) : null;
  const dirty = patch ? Object.keys(patch).length > 0 : true;
  const pending = createTrigger.isPending || updateTrigger.isPending;
  const error = (trigger ? updateTrigger.error : createTrigger.error) as Error | null;
  const canSave = dirty && !pending && !!values.name.trim() && !!values.prompt.trim() && scheduleOk
    && (target !== 'workspace' || !!values.workspaceId);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    if (trigger && patch) {
      updateTrigger.mutate({ id: trigger.id, ...patch });
      return;
    }
    const schedule = scheduleResult.schedule;
    if (!schedule || !values.workspaceId) return;
    createTrigger.mutate({
      name: values.name.trim(),
      description: values.description.trim() || null,
      prompt: values.prompt.trim(),
      targetKind: 'workspace',
      workspaceId: values.workspaceId,
      provider: runsOn.provider ?? undefined,
      model: runsOn.model,
      ...(runsOn.effort ? { effort: runsOn.effort } : {}),
      ...(runsOn.serviceTier ? { serviceTier: runsOn.serviceTier } : {}),
      ...schedule,
      intervalSeconds: schedule.intervalSeconds ?? null,
      runAt: schedule.runAt ?? null,
      timezone: values.schedule.timezone,
      activeHoursStart: values.activeHoursStart || null,
      activeHoursEnd: values.activeHoursEnd || null,
      timeoutSeconds: values.timeoutSeconds,
      concurrencyPolicy: values.concurrencyPolicy,
    }, {
      onSuccess: (result) => {
        if ('webhookSecret' in result && result.webhookSecret && 'webhookPublicId' in result && result.webhookPublicId) {
          onCreated?.(result.trigger, { publicId: result.webhookPublicId, secret: result.webhookSecret });
          return;
        }
        onCreated?.(result.trigger);
      },
    });
  }

  const selectedWorkspace = workspaces?.find((w) => w.id === values.workspaceId);
  const noWorkspaces = target === 'workspace' && workspaces && workspaces.length === 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Field label="Name" required>
        <input
          type="text"
          value={values.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Morning briefing"
          required
          disabled={locked.has('name')}
          className={inputCls}
        />
      </Field>

      <Field label="Description">
        <input
          type="text"
          value={values.description}
          onChange={(e) => set({ description: e.target.value })}
          placeholder="Optional. What it's for, in a line"
          disabled={locked.has('description')}
          className={inputCls}
        />
      </Field>

      <div className="space-y-1">
        <span className="block text-[12px] font-medium text-foreground">
          {isHeartbeat ? 'Instructions' : 'Message'}
          <span className="text-destructive ml-0.5">*</span>
        </span>
        {isHeartbeat && (
          <p className="text-[11px] text-muted-foreground">Sent after the app&apos;s ground rules, which it always follows.</p>
        )}
        <div className="rounded-lg border border-border bg-card">
          <textarea
            aria-label={isHeartbeat ? 'Instructions' : 'Message'}
            value={values.prompt}
            onChange={(e) => set({ prompt: e.target.value })}
            placeholder="Check my calendar for today's meetings and summarize my unread emails. Highlight anything urgent."
            required
            rows={6}
            disabled={locked.has('prompt')}
            className="w-full px-3 py-3 bg-transparent text-sm resize-y focus-visible:outline-none disabled:opacity-60"
          />
          {target !== 'session' && (
            <div className="flex flex-wrap items-center gap-2 px-2 py-2 border-t border-border/60">
              {target === 'workspace' ? (
                <WorkspacePill
                  label={selectedWorkspace?.name ?? 'Pick an agent'}
                  emoji={selectedWorkspace?.emoji ?? null}
                  onChange={(workspaceId) => set({ workspaceId })}
                  workspaces={workspaces ?? []}
                />
              ) : (
                <span className="px-1 text-[12px] text-muted-foreground">A new {APP_NAME} chat each time</span>
              )}
              <div className="flex-1" />
              <RunsOnPicker
                value={runsOn}
                onChange={(change) => set({ runsOn: {
                  provider: change.provider ?? runsOn.provider,
                  model: change.model !== undefined ? change.model : runsOn.model,
                  effort: change.effort !== undefined ? change.effort : runsOn.effort,
                  serviceTier: change.serviceTier !== undefined ? change.serviceTier : runsOn.serviceTier ?? null,
                } })}
                disabled={pending}
              />
            </div>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {target === 'session'
            ? 'This job runs in its chat, under that chat’s own permission to message other chats and start new ones.'
            : 'When this job runs, it can message other chats and start new chats for its assignment.'}
        </p>
        {noWorkspaces && (
          <p className="text-[11px] text-destructive">Create an agent before adding a scheduled task.</p>
        )}
      </div>

      {trigger?.targetKind === 'session' && (
        <section className="space-y-1">
          <span className="block text-[12px] font-medium text-foreground">Sends to</span>
          <TriggerTargetChat sessionId={trigger.targetSessionId} concurrencyPolicy={values.concurrencyPolicy} />
        </section>
      )}

      <TriggerScheduleFields
        // A schedule replaced from outside starts its controls over (the
        // interval's unit is picked from the value once).
        key={stable(base.schedule)}
        value={values.schedule}
        onChange={(schedule) => set({ schedule })}
        kinds={kinds}
        disabled={pending}
      />

      <Advanced
        values={values}
        set={set}
        target={target}
        locked={locked}
      />

      {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}

      <div className="flex items-center justify-end gap-3 pt-2">
        {trigger ? (
          dirty && (
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, values: f.base }))}
              disabled={pending}
              className="px-4 py-2 text-sm rounded-md text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Discard changes
            </button>
          )
        ) : (
          onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm rounded-md text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          )
        )}
        <button
          type="submit"
          disabled={!canSave}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          <Save size={14} />
          {pending ? 'Saving…' : trigger ? 'Save changes' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function Advanced({
  values,
  set,
  target,
  locked,
}: {
  values: Values;
  set: (change: Partial<Values>) => void;
  target: TriggerRecord['targetKind'];
  locked: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Advanced
      </button>
      {open && (
        <div className="space-y-4 border-l-2 border-border pl-4">
          {target !== 'session' && (
            <Field label="Time limit in seconds (optional)">
              <input
                type="number"
                min={60}
                step={60}
                value={values.timeoutSeconds ?? ''}
                placeholder="No limit"
                disabled={locked.has('timeoutSeconds')}
                onChange={(e) => set({ timeoutSeconds: e.target.value === '' ? null : Number(e.target.value) })}
                className={inputCls}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Leave blank to let a run take as long as it needs. A run past the limit is stopped.
              </p>
            </Field>
          )}
          <Field label="If the last run is still going">
            <select
              value={values.concurrencyPolicy}
              disabled={locked.has('concurrencyPolicy')}
              onChange={(e) => set({ concurrencyPolicy: e.target.value as TriggerConcurrencyPolicy })}
              className={inputCls}
            >
              <option value="skip_if_running">Skip this run</option>
              <option value="coalesce_if_active">
                {target === 'session' ? 'Add it to the turn under way' : 'Add it to the running chat'}
              </option>
              {target === 'orchestrator' && <option value="allow_concurrent">Run alongside it</option>}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Active hours start">
              <input
                type="time"
                value={values.activeHoursStart}
                onChange={(e) => set({ activeHoursStart: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="Active hours end">
              <input
                type="time"
                value={values.activeHoursEnd}
                onChange={(e) => set({ activeHoursEnd: e.target.value })}
                className={inputCls}
              />
            </Field>
          </div>
        </div>
      )}
    </>
  );
}

function WorkspacePill({
  label,
  emoji,
  onChange,
  workspaces,
}: {
  label: string;
  emoji: string | null;
  onChange: (id: string) => void;
  workspaces: Array<{ id: string; name: string; emoji: string | null }>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Agent"
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border bg-card text-[12px] text-muted-foreground hover:text-foreground"
      >
        <FolderOpen size={12} />
        {emoji ? <span>{emoji}</span> : null}
        <span>{label}</span>
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 min-w-[180px] rounded-md border border-border bg-card shadow-md p-1">
          {workspaces.length === 0 && <p className="px-2 py-1 text-[11px] text-muted-foreground">No agents.</p>}
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => {
                onChange(w.id);
                setOpen(false);
              }}
              className="w-full text-left px-2 py-1 text-[12px] hover:bg-muted rounded flex items-center gap-1.5"
            >
              {w.emoji && <span>{w.emoji}</span>}
              <span>{w.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children, required = false }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block space-y-1">
      <span className="text-[12px] font-medium text-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

const inputCls = cn(
  'w-full px-3 py-2 rounded-md border border-border bg-card text-sm',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
);

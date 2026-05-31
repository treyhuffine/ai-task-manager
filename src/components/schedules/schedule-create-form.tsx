'use client';

/**
 * Schedule create form. Extracted from `/schedules/new` so the rail's
 * Schedules modal can reuse the exact same UI without a page-route
 * round-trip. The page wraps this in a full-page chrome; the modal
 * embeds it directly in its body.
 *
 * Two callbacks model what the surrounding shell does on outcome:
 *   - `onCreated(schedule, webhookCreds?)` — fires on a successful
 *     create. For non-webhook schedules, the caller usually closes the
 *     modal / navigates to detail. For webhook schedules, the caller
 *     should swap to the credentials panel since the plaintext secret
 *     is only available once.
 *   - `onCancel()` — fires on the cancel button.
 *
 * The form has no internal chrome (no page header, no close button).
 * That's the wrapper's responsibility, which keeps the form usable in
 * either context unchanged.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Save,
  Sparkles,
} from 'lucide-react';
import { useCreateSchedule } from '@/hooks/use-schedules';
import { useWorkspaces } from '@/hooks/use-workspaces';
import {
  frequencyToSchedule,
  type FrequencyKind,
  type Weekday,
} from '@/lib/scheduler/frequency';
import type { EffortLevel, ScheduleRecord } from '@/db/types';
import { cn } from '@/lib/utils';

const FREQUENCY_OPTIONS: { value: FrequencyKind; label: string }[] = [
  { value: 'manual', label: 'Manual — Run now only' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'custom', label: 'Custom cron' },
];

const WEEKDAY_LABELS: { value: Weekday; label: string }[] = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
];

export interface WebhookCredentials {
  publicId: string;
  secret: string;
}

export interface ScheduleCreateFormProps {
  /** Fires on successful schedule creation. */
  onCreated(schedule: ScheduleRecord, webhook?: WebhookCredentials): void;
  /** Fires on cancel button. */
  onCancel(): void;
}

export function ScheduleCreateForm({ onCreated, onCancel }: ScheduleCreateFormProps) {
  const createSchedule = useCreateSchedule();
  const { data: workspaces } = useWorkspaces();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [frequency, setFrequency] = useState<FrequencyKind>('manual');
  const [time, setTime] = useState('09:00');
  const [weekday, setWeekday] = useState<Weekday>(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [cronExpression, setCronExpression] = useState('0 9 * * *');

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  );
  const [effort, setEffort] = useState<EffortLevel | ''>('');
  // null = no wall-clock timeout (the default). Users who explicitly
  // want a cap set a positive integer via the Advanced field.
  const [timeoutSeconds, setTimeoutSeconds] = useState<number | null>(null);
  const [activeHoursStart, setActiveHoursStart] = useState('');
  const [activeHoursEnd, setActiveHoursEnd] = useState('');
  const [concurrencyPolicy, setConcurrencyPolicy] = useState<
    'skip_if_running' | 'coalesce_if_active' | 'allow_concurrent'
  >('coalesce_if_active');

  useEffect(() => {
    if (workspaces && workspaces.length === 1 && !workspaceId) {
      setWorkspaceId(workspaces[0].id);
    }
  }, [workspaces, workspaceId]);

  const compiledCron = useMemo(() => {
    try {
      return frequencyToSchedule({
        kind: frequency,
        time,
        weekday,
        dayOfMonth,
        cronExpression,
      });
    } catch {
      return null;
    }
  }, [frequency, time, weekday, dayOfMonth, cronExpression]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedPrompt = prompt.trim();
    const trimmedDescription = description.trim();
    if (!trimmedName || !trimmedPrompt || !trimmedDescription) return;
    if (!workspaceId) return;
    if (!compiledCron) return;

    const input = {
      name: trimmedName,
      description: trimmedDescription,
      prompt: trimmedPrompt,
      targetKind: 'workspace' as const,
      workspaceId,
      agentId: undefined,
      kind: compiledCron.kind,
      cronExpression: compiledCron.cronExpression,
      intervalSeconds: null,
      runAt: null,
      timezone,
      activeHoursStart: activeHoursStart || null,
      activeHoursEnd: activeHoursEnd || null,
      model: model.trim() || null,
      effort: (effort || null) as EffortLevel | null,
      timeoutSeconds,
      concurrencyPolicy,
    };
    createSchedule.mutate(input, {
      onSuccess: (result) => {
        if (result.webhookSecret && result.webhookPublicId) {
          onCreated(result.schedule, {
            publicId: result.webhookPublicId,
            secret: result.webhookSecret,
          });
          return;
        }
        onCreated(result.schedule);
      },
    });
  }

  const selectedWorkspace = workspaces?.find((w) => w.id === workspaceId);
  const noWorkspaces = workspaces && workspaces.length === 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Field label="Name" required>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="daily-briefing"
          required
          className={inputCls}
        />
      </Field>

      <Field label="Description" required>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Summarize my calendar and inbox for the day"
          required
          className={inputCls}
        />
      </Field>

      <div className="space-y-0">
        <div className="rounded-lg border border-border bg-card">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Check my calendar for today's meetings and summarize my unread emails. Highlight anything urgent."
            required
            rows={6}
            className="w-full px-3 py-3 bg-transparent text-sm resize-none focus-visible:outline-none"
          />
          <div className="flex items-center gap-2 px-2 py-2 border-t border-border/60">
            <WorkspacePill
              label={selectedWorkspace?.name ?? 'Pick a workspace'}
              emoji={selectedWorkspace?.emoji ?? null}
              onChange={setWorkspaceId}
              workspaces={workspaces ?? []}
            />
            <div className="flex-1" />
            <ModelPill value={model} onChange={setModel} />
          </div>
        </div>
        {noWorkspaces && (
          <p className="text-[11px] text-destructive mt-1">
            Create a workspace before adding a scheduled task.
          </p>
        )}
      </div>

      <Field label="Frequency">
        <div className="space-y-2">
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as FrequencyKind)}
            className={inputCls}
          >
            {FREQUENCY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          {frequency === 'daily' && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">at</span>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className={cn(inputCls, 'w-32')}
              />
            </div>
          )}

          {frequency === 'weekly' && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-muted-foreground">on</span>
              <select
                value={String(weekday)}
                onChange={(e) => setWeekday(Number(e.target.value) as Weekday)}
                className={cn(inputCls, 'w-36')}
              >
                {WEEKDAY_LABELS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-muted-foreground">at</span>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className={cn(inputCls, 'w-32')}
              />
            </div>
          )}

          {frequency === 'monthly' && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-muted-foreground">on the</span>
              <input
                type="number"
                min={1}
                max={28}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Number(e.target.value))}
                className={cn(inputCls, 'w-20')}
              />
              <span className="text-[11px] text-muted-foreground">at</span>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className={cn(inputCls, 'w-32')}
              />
              <span className="text-[10px] text-muted-foreground">
                (capped at 28 so February works)
              </span>
            </div>
          )}

          {frequency === 'custom' && (
            <input
              type="text"
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
              placeholder="0 9 * * 1-5"
              className={cn(inputCls, 'font-mono text-xs')}
            />
          )}

          {frequency === 'webhook' && (
            <p className="text-[11px] text-muted-foreground p-3 border border-border rounded-md">
              A public ID + signing secret are generated on save. The
              secret is shown once and used to sign incoming POSTs.
            </p>
          )}

          {frequency === 'manual' && (
            <p className="text-[11px] text-muted-foreground p-3 border border-border rounded-md">
              No automatic firing. Use the &ldquo;Run now&rdquo; button on
              the detail page or call <code>flow schedule run</code>.
            </p>
          )}
        </div>
      </Field>

      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
      >
        {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Advanced
      </button>

      {showAdvanced && (
        <div className="space-y-4 border-l-2 border-border pl-4">
          <Field label="Timezone">
            <input
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="America/New_York"
              className={inputCls}
            />
          </Field>
          <Field label="Effort">
            <select
              value={effort}
              onChange={(e) => setEffort(e.target.value as EffortLevel | '')}
              className={inputCls}
            >
              <option value="">Default</option>
              {(['low', 'medium', 'high', 'xhigh', 'max'] as const).map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Wall-clock timeout (seconds, optional)">
            <input
              type="number"
              min={60}
              step={60}
              value={timeoutSeconds ?? ''}
              placeholder="No timeout"
              onChange={(e) => {
                const raw = e.target.value;
                setTimeoutSeconds(raw === '' ? null : Number(raw));
              }}
              className={inputCls}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Leave blank to let the run go as long as it needs. A hard
              cap that fires `interrupt()` on the agent — use only when
              you want to protect against a specific runaway pattern.
              The run page surfaces &ldquo;stalled&rdquo; status on its own.
            </p>
          </Field>
          <Field label="If a previous run is still in flight">
            <select
              value={concurrencyPolicy}
              onChange={(e) =>
                setConcurrencyPolicy(
                  e.target.value as 'skip_if_running' | 'coalesce_if_active' | 'allow_concurrent',
                )
              }
              className={inputCls}
            >
              <option value="coalesce_if_active">
                Append to the running run&apos;s chat
              </option>
              <option value="skip_if_running">Skip this fire</option>
              <option value="allow_concurrent">
                Allow concurrent (orchestrator only)
              </option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Active hours start">
              <input
                type="time"
                value={activeHoursStart}
                onChange={(e) => setActiveHoursStart(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Active hours end">
              <input
                type="time"
                value={activeHoursEnd}
                onChange={(e) => setActiveHoursEnd(e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>
        </div>
      )}

      {createSchedule.error && (
        <p className="text-sm text-destructive">
          {(createSchedule.error as Error).message}
        </p>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm rounded-md text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={createSchedule.isPending || !workspaceId || !compiledCron}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          <Save size={14} />
          {createSchedule.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

// ── Internal pill components ─────────────────────────────────

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
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border bg-card text-[12px] text-muted-foreground hover:text-foreground"
      >
        <FolderOpen size={12} />
        {emoji ? <span>{emoji}</span> : null}
        <span>{label}</span>
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 min-w-[180px] rounded-md border border-border bg-card shadow-md p-1">
          {workspaces.length === 0 && (
            <p className="px-2 py-1 text-[11px] text-muted-foreground">
              No workspaces.
            </p>
          )}
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

function ModelPill({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = value || 'Default model';
  const presets = [
    { id: '', label: 'Default model' },
    { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ];
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border bg-card text-[12px] text-muted-foreground hover:text-foreground"
      >
        <Sparkles size={12} />
        <span>{label}</span>
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 min-w-[180px] rounded-md border border-border bg-card shadow-md p-1">
          {presets.map((p) => (
            <button
              key={p.id || 'default'}
              type="button"
              onClick={() => {
                onChange(p.id);
                setOpen(false);
              }}
              className={cn(
                'w-full text-left px-2 py-1 text-[12px] hover:bg-muted rounded',
                value === p.id && 'bg-muted',
              )}
            >
              {p.label}
            </button>
          ))}
          <div className="px-2 py-1.5 border-t border-border mt-1">
            <input
              type="text"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Custom id…"
              className="w-full px-2 py-1 text-[11px] rounded border border-border bg-background"
            />
          </div>
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

const inputCls =
  'w-full px-3 py-2 rounded-md border border-border bg-card text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

// ── Webhook credentials panel ────────────────────────────────
//
// Co-located here because both the page and the modal use it after a
// successful webhook create.

export function WebhookCredentialsPanel({
  publicId,
  secret,
  onContinue,
}: {
  publicId: string;
  secret: string;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">Webhook ready</h2>
      <p className="text-sm text-muted-foreground">
        Save the secret below — it&apos;s shown once and never displayed
        again. Sign each request body with HMAC-SHA256 using this
        secret and send the hex as <code className="font-mono">X-Signature</code>,
        plus the plaintext as <code className="font-mono">X-Webhook-Secret</code>.
      </p>
      <CredentialRow label="Public ID" value={publicId} />
      <CredentialRow label="Secret" value={secret} mono />
      <div className="p-3 rounded-md bg-muted text-[12px] text-muted-foreground space-y-1">
        <p>Endpoint:</p>
        <code className="font-mono break-all">POST /api/triggers/{publicId}</code>
      </div>
      <button
        type="button"
        onClick={onContinue}
        className="w-full px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
      >
        I&apos;ve saved the secret — continue
      </button>
    </div>
  );
}

function CredentialRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <div className="flex items-center gap-2 mt-1">
        <code
          className={cn(
            'flex-1 px-2 py-1.5 rounded border border-border bg-background break-all',
            mono ? 'font-mono text-xs' : 'text-sm',
          )}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(value)}
          className="px-2 py-1.5 rounded-md text-xs border border-border hover:bg-muted"
        >
          Copy
        </button>
      </div>
    </div>
  );
}

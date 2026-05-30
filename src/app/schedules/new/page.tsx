'use client';

/**
 * Schedule creation form at /schedules/new.
 *
 * Single form, top-to-bottom per docs/async-agents-v1.md §8.3:
 *   1. What — name + prompt + optional description
 *   2. When — kind picker (schedule/every/at/webhook) with NL→cron
 *               heuristic for "cron". Resolved expression + next 3 fires
 *               shown beneath.
 *   3. Where — target (workspace dropdown / orchestrator) + skills
 *   4. Settings — model, effort, timeout, active hours
 *   5. Save — preview next fire, then submit
 *
 * On webhook create, the response includes the plaintext secret —
 * shown once in a banner with copy + reminder that it can't be
 * retrieved again.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save } from 'lucide-react';
import { useCreateSchedule } from '@/hooks/use-schedules';
import { useWorkspaces } from '@/hooks/use-workspaces';
import { useAgents } from '@/hooks/use-agents';
import { naturalLanguageToCron } from '@/lib/scheduler/nl-cron';
import type { ScheduleKind, ScheduleTargetKind, EffortLevel } from '@/db/types';

export default function NewSchedulePage() {
  const router = useRouter();
  const createSchedule = useCreateSchedule();
  const { data: workspaces } = useWorkspaces();
  const { data: agents } = useAgents();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [kind, setKind] = useState<ScheduleKind>('cron');
  const [nlCron, setNlCron] = useState('every weekday at 9am');
  const [cronExpression, setCronExpression] = useState('0 9 * * 1-5');
  const [intervalSeconds, setIntervalSeconds] = useState(1800);
  const [runAt, setRunAt] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [targetKind, setTargetKind] = useState<ScheduleTargetKind>('orchestrator');
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState<EffortLevel | ''>('');
  const [timeoutSeconds, setTimeoutSeconds] = useState(900);
  const [activeHoursStart, setActiveHoursStart] = useState('');
  const [activeHoursEnd, setActiveHoursEnd] = useState('');
  const [createdWebhook, setCreatedWebhook] = useState<{
    secret: string;
    publicId: string;
  } | null>(null);

  // Default agent: pick the first orchestrator/executor that matches target.
  useEffect(() => {
    if (agentId || !agents) return;
    const want = targetKind === 'orchestrator' ? 'orchestrator' : 'executor';
    const match = agents.find((a) => a.kind === want);
    if (match) setAgentId(match.id);
  }, [agents, agentId, targetKind]);

  // NL→cron compile preview.
  const nlCompile = useMemo(() => {
    if (kind !== 'cron') return null;
    return naturalLanguageToCron(nlCron);
  }, [kind, nlCron]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedPrompt = prompt.trim();
    const trimmedDescription = description.trim();
    if (!trimmedName || !trimmedPrompt) return;
    // Clamp interval to the tick's resolution. The runner ticks every
    // 60s, so any interval below that would silently fire at the
    // 60s cadence — the schedule would lie about its cadence. Forcing
    // the floor here matches what the user actually gets.
    const sanitizedInterval = kind === 'every' ? Math.max(60, intervalSeconds) : intervalSeconds;
    const input = {
      name: trimmedName,
      description: trimmedDescription || null,
      prompt: trimmedPrompt,
      // null agentId tells the create action to resolve the
      // orchestrator/workspace default per docs/async-agents-v1.md §4.2.
      agentId: agentId ?? undefined,
      targetKind,
      workspaceId: targetKind === 'workspace' ? workspaceId : null,
      kind,
      cronExpression: kind === 'cron' ? cronExpression : null,
      intervalSeconds: kind === 'every' ? sanitizedInterval : null,
      runAt: kind === 'at' ? runAt : null,
      timezone,
      activeHoursStart: activeHoursStart || null,
      activeHoursEnd: activeHoursEnd || null,
      model: model || null,
      effort: (effort || null) as EffortLevel | null,
      timeoutSeconds,
    };
    createSchedule.mutate(input, {
      onSuccess: (result) => {
        if (result.webhookSecret && result.webhookPublicId) {
          setCreatedWebhook({
            secret: result.webhookSecret,
            publicId: result.webhookPublicId,
          });
          return;
        }
        router.push(`/schedules/${result.schedule.id}`);
      },
    });
  }

  if (createdWebhook) {
    return (
      <WebhookCredentialsPanel
        publicId={createdWebhook.publicId}
        secret={createdWebhook.secret}
        onContinue={() => router.push('/schedules')}
      />
    );
  }

  return (
    <div className="min-h-dvh bg-background text-foreground font-sans">
      <header className="border-b border-border px-6 py-4 flex items-center gap-3 sticky top-0 bg-background z-10">
        <button
          onClick={() => router.push('/schedules')}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-base font-semibold">New schedule</h1>
      </header>

      <form
        onSubmit={handleSubmit}
        className="px-6 py-6 max-w-2xl mx-auto space-y-8"
      >
        <Section title="What">
          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="morning-triage"
              required
              className={inputCls}
            />
          </Field>
          <Field label="Prompt">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Triage stream items captured overnight, suggest tasks for the day…"
              required
              rows={5}
              className={inputCls}
            />
          </Field>
          <Field label="Description (optional)">
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputCls}
            />
          </Field>
        </Section>

        <Section title="When">
          <div className="flex gap-2">
            {(['cron', 'every', 'at', 'webhook'] as ScheduleKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={kindButtonCls(kind === k)}
              >
                {kindLabel(k)}
              </button>
            ))}
          </div>

          {kind === 'cron' && (
            <div className="space-y-3 mt-3">
              <Field label="When (plain English)">
                <input
                  type="text"
                  value={nlCron}
                  onChange={(e) => {
                    setNlCron(e.target.value);
                    const compiled = naturalLanguageToCron(e.target.value);
                    if (compiled.ok) setCronExpression(compiled.expression);
                  }}
                  className={inputCls}
                />
              </Field>
              <Field label="Cron expression">
                <input
                  type="text"
                  value={cronExpression}
                  onChange={(e) => setCronExpression(e.target.value)}
                  className={inputCls + ' font-mono text-xs'}
                />
              </Field>
              <Field label="Timezone">
                <input
                  type="text"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="America/New_York"
                  className={inputCls}
                />
              </Field>
              {nlCompile && (
                <div className="text-[11px] text-muted-foreground border border-border rounded-md p-3">
                  {nlCompile.ok ? (
                    <>
                      <p>Parsed: <span className="font-mono">{nlCompile.expression}</span></p>
                      {nlCompile.previewUtc && nlCompile.previewUtc.length > 0 && (
                        <p className="mt-1">
                          Next 3 fires: {nlCompile.previewUtc.map(humanize).join(' · ')}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-destructive">{nlCompile.error}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {kind === 'every' && (
            <Field label="Interval (seconds)">
              <input
                type="number"
                min={60}
                step={60}
                value={intervalSeconds}
                onChange={(e) => setIntervalSeconds(Number(e.target.value))}
                className={inputCls}
              />
            </Field>
          )}

          {kind === 'at' && (
            <Field label="Fire at (ISO timestamp)">
              <input
                type="datetime-local"
                value={runAt}
                onChange={(e) => setRunAt(new Date(e.target.value).toISOString())}
                className={inputCls}
              />
            </Field>
          )}

          {kind === 'webhook' && (
            <p className="text-[11px] text-muted-foreground mt-3 border border-border rounded-md p-3">
              A public id + signing secret will be generated on save. The
              secret is shown once and used to HMAC-sign incoming POSTs.
            </p>
          )}
        </Section>

        <Section title="Where">
          <Field label="Target">
            <div className="flex gap-2">
              {(['orchestrator', 'workspace'] as ScheduleTargetKind[]).map((tk) => (
                <button
                  key={tk}
                  type="button"
                  onClick={() => setTargetKind(tk)}
                  className={kindButtonCls(targetKind === tk)}
                >
                  {tk === 'orchestrator' ? 'Orchestrator' : 'Workspace'}
                </button>
              ))}
            </div>
          </Field>

          {targetKind === 'workspace' && (
            <Field label="Workspace">
              <select
                value={workspaceId ?? ''}
                onChange={(e) => setWorkspaceId(e.target.value || null)}
                className={inputCls}
              >
                <option value="">— pick one —</option>
                {workspaces?.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Agent (optional)">
            <select
              value={agentId ?? ''}
              onChange={(e) => setAgentId(e.target.value || null)}
              className={inputCls}
            >
              <option value="">— default for this target —</option>
              {agents?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.kind})
                </option>
              ))}
            </select>
          </Field>
        </Section>

        <Section title="Settings">
          <Field label="Model override (optional)">
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="claude-opus-4-7"
              className={inputCls}
            />
          </Field>
          <Field label="Effort (optional)">
            <select
              value={effort}
              onChange={(e) => setEffort(e.target.value as EffortLevel | '')}
              className={inputCls}
            >
              <option value="">— default —</option>
              {(['low', 'medium', 'high', 'xhigh', 'max'] as const).map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Timeout (seconds)">
            <input
              type="number"
              min={60}
              step={60}
              value={timeoutSeconds}
              onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Active hours start (optional)">
              <input
                type="time"
                value={activeHoursStart}
                onChange={(e) => setActiveHoursStart(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Active hours end (optional)">
              <input
                type="time"
                value={activeHoursEnd}
                onChange={(e) => setActiveHoursEnd(e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>
        </Section>

        {createSchedule.error && (
          <p className="text-sm text-destructive">
            {(createSchedule.error as Error).message}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={createSchedule.isPending}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            <Save size={14} />
            {createSchedule.isPending ? 'Saving…' : 'Save schedule'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/schedules')}
            className="px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function WebhookCredentialsPanel({
  publicId,
  secret,
  onContinue,
}: {
  publicId: string;
  secret: string;
  onContinue: () => void;
}) {
  return (
    <div className="min-h-dvh bg-background flex items-center justify-center p-6">
      <div className="max-w-lg w-full space-y-4 border border-border rounded-lg p-6 bg-card">
        <h2 className="text-base font-semibold">Webhook ready</h2>
        <p className="text-sm text-muted-foreground">
          Save the secret below — it&apos;s shown once and never displayed
          again. Sign each incoming request body with HMAC-SHA256 using this
          secret and send the hex digest as <code className="font-mono">X-Signature</code>,
          plus the plaintext as <code className="font-mono">X-Webhook-Secret</code>.
        </p>
        <CredentialRow label="Public ID" value={publicId} />
        <CredentialRow label="Secret" value={secret} mono />
        <div className="p-3 rounded-md bg-muted text-[12px] text-muted-foreground space-y-1">
          <p>Endpoint:</p>
          <code className="font-mono break-all">
            POST /api/triggers/{publicId}
          </code>
        </div>
        <button
          onClick={onContinue}
          className="w-full px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
        >
          I&apos;ve saved the secret — continue
        </button>
      </div>
    </div>
  );
}

function CredentialRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <div className="flex items-center gap-2 mt-1">
        <code
          className={
            'flex-1 px-2 py-1.5 rounded border border-border bg-background break-all ' +
            (mono ? 'font-mono text-xs' : 'text-sm')
          }
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full px-3 py-2 rounded-md border border-border bg-card text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function kindButtonCls(active: boolean): string {
  return `px-3 py-1.5 rounded-md text-sm border transition-all ${
    active
      ? 'border-primary text-primary bg-primary/5'
      : 'border-border text-muted-foreground hover:text-foreground'
  }`;
}

function kindLabel(k: ScheduleKind): string {
  switch (k) {
    case 'cron': return 'Schedule';
    case 'every': return 'Every N';
    case 'at': return 'At a time';
    case 'webhook': return 'Webhook';
  }
}

function humanize(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

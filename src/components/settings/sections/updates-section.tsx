'use client';

import { RuntimeSetup } from '@/components/desktop/runtime-setup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { apiErrorText } from '@/lib/api/client';
import { documentSaves } from '@/lib/client/document-saves';
import type { UpdateRecord } from '@/lib/service/update';
import { describeRollback, maintenanceWindowText, updateProgress, updateStatusText } from '@/lib/service/update-presentation';
import { MaintenanceWindowSchema, type ReleasePreferences, type UpdateAction, type UpdatePreferences } from '@/lib/service/update-settings';
import { trpcClient } from '@/lib/trpc/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SERVICE_STATUS_KEY, serviceStatusQuery } from '@/hooks/use-service-status';
import { useId, useState } from 'react';
import { toast } from 'sonner';

interface Status {
  phase: string;
  version?: string;
  canManage: boolean;
  canUseUpdates: boolean;
  update?: UpdateRecord & { configured: boolean; busy: boolean; waitingLong: boolean; policy?: ReleasePreferences | null; origin: { source: 'published' | 'checkout'; checkout?: string } };
}

/** Remount only when the persisted approval changes, so two-second status
 * polling cannot erase a maintenance window the user is still editing. */
function ActivationSettings({ update, disabled, onAction }: {
  update: NonNullable<Status['update']>;
  disabled: boolean;
  onAction: (action: UpdateAction) => Promise<void>;
}) {
  const id = useId();
  const [scheduled, setScheduled] = useState(!!update.window);
  const [hour, setHour] = useState(String(update.window?.hour ?? 3));
  const [duration, setDuration] = useState(String(update.window?.durationHours ?? 2));
  const [timeZone, setTimeZone] = useState(update.window?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const schedule = () => {
    const result = MaintenanceWindowSchema.safeParse({ hour: Number(hour), durationHours: Number(duration), timeZone });
    if (scheduled && !result.success) { toast.error(result.error.issues[0]?.message ?? 'Check the maintenance window'); return; }
    void onAction({ action: 'when-idle', ...(scheduled && result.success ? { window: result.data } : {}) });
  };

  return <div className="space-y-4 rounded-lg border p-4">
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor={`${id}-scheduled`}>Use a maintenance window</Label>
        <p id={`${id}-schedule-help`} className="text-xs text-muted-foreground">Update only during these hours, once it&apos;s also quiet.</p>
      </div>
      <Switch id={`${id}-scheduled`} checked={scheduled} onCheckedChange={setScheduled} disabled={disabled} aria-describedby={`${id}-schedule-help`} />
    </div>
    {scheduled && <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor={`${id}-hour`}>Start time</Label>
        <Select value={hour} onValueChange={setHour} disabled={disabled}>
          <SelectTrigger id={`${id}-hour`}><SelectValue /></SelectTrigger>
          <SelectContent>{Array.from({ length: 24 }, (_, value) => <SelectItem key={value} value={String(value)}>{String(value).padStart(2, '0')}:00</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-duration`}>Window length</Label>
        <Select value={duration} onValueChange={setDuration} disabled={disabled}>
          <SelectTrigger id={`${id}-duration`}><SelectValue /></SelectTrigger>
          <SelectContent>{Array.from({ length: 12 }, (_, index) => index + 1).map(value => <SelectItem key={value} value={String(value)}>{value} {value === 1 ? 'hour' : 'hours'}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={`${id}-zone`}>Time zone</Label>
        <Input id={`${id}-zone`} value={timeZone} onChange={event => setTimeZone(event.target.value)} disabled={disabled} placeholder="America/Denver" autoComplete="off" spellCheck={false} />
        <p className="text-xs text-muted-foreground">The selected time zone stays the same when you travel. If this computer is asleep or busy, Ri waits for another eligible window.</p>
      </div>
    </div>}
    {update.approved && !update.now && update.window && <p className="text-muted-foreground">Scheduled {maintenanceWindowText(update.window)}.</p>}
    <div className="flex flex-wrap gap-2">
      <Button disabled={disabled} onClick={schedule}>{scheduled ? 'Schedule update' : 'Update when idle'}</Button>
    </div>
  </div>;
}

function WhatIsWaiting({ update, canUse, disabled, onAction }: {
  update: NonNullable<Status['update']>;
  canUse: boolean;
  disabled: boolean;
  onAction: (action: UpdateAction) => Promise<void>;
}) {
  const waiting = update.phase === 'waiting';
  // Numbers mean running work, which Update now offers to stop.
  const running = waiting && /^\d+ /.test(update.reason ?? '');
  return <div className="space-y-2">
    {update.waitingLong && <p role="status" className="text-muted-foreground">This update has been waiting for over a day.</p>}
    {canUse && <div className="flex flex-wrap gap-2">
      {!running && <Button disabled={disabled} onClick={() => void onAction({ action: 'apply' })}>Update now</Button>}
      {running && <Button disabled={disabled} variant="outline" onClick={() => void onAction({ action: 'apply-now' })}>Update now and end them</Button>}
      {waiting && update.automatic && !update.heldUntil && <Button disabled={disabled} variant="ghost" onClick={() => void onAction({ action: 'later' })}>Not now</Button>}
      {waiting && !update.automatic && <Button disabled={disabled} variant="ghost" onClick={() => void onAction({ action: 'later' })}>Don&apos;t update yet</Button>}
    </div>}
  </div>;
}

function GoBack({ disabled, onConfirm }: { disabled: boolean; onConfirm: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [available, setAvailable] = useState(false);
  const look = async () => {
    try {
      const { rollback } = await trpcClient.service.updateRollbackGet.query({});
      setAvailable(rollback.available);
      setText(describeRollback('this Home', rollback));
    } catch (error) { toast.error(apiErrorText(error)); }
  };
  return <div className="space-y-2">
    {!text && <Button variant="outline" disabled={disabled} onClick={() => void look()}>Go back to the previous version…</Button>}
    {text && <>
      <p className="whitespace-pre-wrap text-muted-foreground">{text}</p>
      <div className="flex gap-2">
        {available && <Button variant="destructive" disabled={disabled} onClick={() => void onConfirm().then(() => setText(''))}>Roll back</Button>}
        <Button variant="ghost" disabled={disabled} onClick={() => setText('')}>{available ? 'Cancel' : 'Close'}</Button>
      </div>
    </>}
  </div>;
}

export function UpdatesSection() {
  const id = useId();
  const client = useQueryClient();
  const [working, setWorking] = useState(false);
  const status = useQuery(serviceStatusQuery(2000));
  const data = status.data;
  const update = data && 'update' in data ? data.update : undefined;
  const action = async (input: UpdateAction) => {
    setWorking(true);
    try {
      if (input.action === 'apply' || input.action === 'apply-now' || input.action === 'when-idle') await documentSaves.flushAll();
      await trpcClient.service.updatePost.mutate({body: input});
      await client.invalidateQueries({ queryKey: SERVICE_STATUS_KEY });
    } catch (error) { toast.error(apiErrorText(error)); }
    finally { setWorking(false); }
  };
  const savePreferences = async (preferences: UpdatePreferences) => {
    setWorking(true);
    try {
      await trpcClient.service.updatePolicyPatch.mutate({body: preferences});
      await client.invalidateQueries({ queryKey: SERVICE_STATUS_KEY });
    } catch (error) { toast.error(apiErrorText(error)); }
    finally { setWorking(false); }
  };
  if (!data) return <p className="text-sm text-muted-foreground">{status.error ? 'The service is reconnecting. Your drafts remain on this device.' : 'Checking the local service…'}</p>;
  if (data.phase === 'unmanaged') return <p className="text-sm text-muted-foreground">This Ri runs from a source checkout, started by hand. To keep it running and update it safely, run <code>pnpm cli:dev update --from .</code> and then <code>ri start</code>.</p>;
  const disabled = working || !!update?.busy || !!status.error;
  const progress = update ? updateProgress(update) : null;
  const fromCheckout = update?.origin.source === 'checkout';
  const inProgress = update && ['ready', 'waiting'].includes(update.phase);
  // Update now fetches it first, for someone who can't reach Download under Advanced.
  const canFetch = !!update?.release && !fromCheckout && ['available', 'failed'].includes(update.phase);

  return <div className="space-y-5 text-sm">
    <div><p>Ri {data.version}</p></div>
    {status.error && <p role="status" className="text-muted-foreground">Reconnecting to the service. The last known update status is shown below.</p>}
    {update && <div className="space-y-2">
      {update.release && update.phase !== 'committed' && update.phase !== 'idle' && <p>Release {update.release.version}</p>}
      {update.release?.notes && inProgress && <p className="whitespace-pre-wrap text-muted-foreground">{update.release.notes}</p>}
      <p role="status" aria-live="polite">{updateStatusText(update)}</p>
      {progress && <div className="space-y-1">
        <progress className="h-2 w-full accent-primary" max={100} value={progress.percent} aria-label="Update download" />
        <p className="text-xs text-muted-foreground">{progress.text}</p>
      </div>}
      {update.error && <p role="alert" className="text-destructive">{update.error}</p>}
    </div>}
    {update && (inProgress || canFetch) && <WhatIsWaiting update={update} canUse={data.canUseUpdates} disabled={disabled} onAction={action} />}
    {fromCheckout && <p className="text-muted-foreground">This computer builds Ri from {update?.origin.checkout ?? 'a checkout'} when someone runs <code>ri update</code>. Automatic updates apply to published releases.</p>}
    {update && !fromCheckout && !update.configured && <p className="text-muted-foreground">This build has no release publisher configured, so it can&apos;t update itself. Install a published release to enable updates.</p>}
    {update?.configured && !fromCheckout && update.policy && <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
      <div className="space-y-1">
        <Label htmlFor={`${id}-automatic`}>Automatic updates</Label>
        <p id={`${id}-automatic-help`} className="text-xs text-muted-foreground">Ri updates itself when it&apos;s quiet, after a 1-minute notice. It never stops running work, and this applies to every Ri on this computer.</p>
      </div>
      <Switch id={`${id}-automatic`} checked={update.policy.auto} disabled={disabled || !data.canUseUpdates} aria-describedby={`${id}-automatic-help`} onCheckedChange={auto => void savePreferences({ auto })} />
    </div>}
    {!data.canUseUpdates && update?.configured && <p className="text-muted-foreground">The owner of this computer manages its updates.</p>}
    {data.canManage && update && <details className="space-y-4 rounded-lg border p-4">
      <summary className="cursor-pointer font-medium">Advanced</summary>
      <div className="mt-4 space-y-4">
        {update.configured && !fromCheckout && <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={disabled || update.phase === 'recovery-required'} onClick={() => void action({ action: 'check' })}>Check for updates</Button>
          {update.release && ['available', 'failed'].includes(update.phase) && <Button disabled={disabled} onClick={() => void action({ action: 'download' })}>{update.phase === 'failed' ? 'Retry download' : 'Download update'}</Button>}
        </div>}
        {update.policy && !fromCheckout && <>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1"><Label htmlFor={`${id}-channel`}>Release channel</Label><p className="text-xs text-muted-foreground">Latest gets every release as it ships.</p></div>
            <Select value={update.policy.channel} disabled={disabled} onValueChange={channel => void savePreferences({ channel: channel as 'stable' | 'latest' })}>
              <SelectTrigger id={`${id}-channel`} className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="stable">Stable</SelectItem><SelectItem value="latest">Latest</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1"><Label htmlFor={`${id}-metered`}>Limit downloads on this connection</Label><p id={`${id}-metered-help`} className="text-xs text-muted-foreground">Pause automatic downloads until you turn this off. Manual downloads are still available. Ri does not detect metered networks automatically.</p></div>
            <Switch id={`${id}-metered`} checked={update.policy.metered} disabled={disabled} aria-describedby={`${id}-metered-help`} onCheckedChange={metered => void savePreferences({ metered })} />
          </div>
        </>}
        {inProgress && <ActivationSettings key={`${update.release?.runtime.id}:${JSON.stringify(update.window)}:${!!update.approved}`} update={update} disabled={disabled} onAction={action} />}
        <GoBack disabled={disabled} onConfirm={() => action({ action: 'rollback' })} />
      </div>
    </details>}
    {data.canManage && <RuntimeSetup />}
  </div>;
}

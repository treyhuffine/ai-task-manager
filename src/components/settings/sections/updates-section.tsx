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
import { maintenanceWindowText, updateProgress, updateStatusText } from '@/lib/service/update-presentation';
import { MaintenanceWindowSchema, type ReleasePreferences, type UpdateAction, type UpdatePreferences } from '@/lib/service/update-settings';
import { trpcClient } from '@/lib/trpc/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { toast } from 'sonner';

interface Status {
  phase: string;
  version?: string;
  canManage: boolean;
  update?: UpdateRecord & { configured: boolean; busy: boolean; policy?: ReleasePreferences | null };
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
        <p id={`${id}-schedule-help`} className="text-xs text-muted-foreground">Approve this update for a quiet time. Future updates still need approval.</p>
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
    {update.approved && <p className="text-muted-foreground">{update.window ? `Scheduled ${maintenanceWindowText(update.window)}.` : 'Approved to update as soon as the service is idle.'}</p>}
    <div className="flex flex-wrap gap-2">
      <Button disabled={disabled} onClick={schedule}>{scheduled ? 'Schedule update' : 'Update when idle'}</Button>
      <Button variant="outline" disabled={disabled} onClick={() => void onAction({ action: 'apply' })}>Restart and update</Button>
      {update.phase === 'waiting' && <Button variant="ghost" disabled={disabled} onClick={() => void onAction({ action: 'later' })}>Later</Button>}
    </div>
    <p className="text-xs text-muted-foreground">Restart and update requests the next safe moment without waiting for the scheduled window. Running work is never forcibly stopped.</p>
  </div>;
}

export function UpdatesSection() {
  const id = useId();
  const client = useQueryClient();
  const [working, setWorking] = useState(false);
  const status = useQuery({ queryKey: ['local-service'], queryFn: () => trpcClient.service.list.query({}), refetchInterval: 2000, retry: false });
  const data = status.data;
  const update = data && 'update' in data ? data.update : undefined;
  const action = async (input: UpdateAction) => {
    setWorking(true);
    try {
      if (input.action === 'apply' || input.action === 'when-idle') await documentSaves.flushAll();
      await trpcClient.service.updatePost.mutate({body: input});
      await client.invalidateQueries({ queryKey: ['local-service'] });
    } catch (error) { toast.error(apiErrorText(error)); }
    finally { setWorking(false); }
  };
  const savePreferences = async (preferences: UpdatePreferences) => {
    setWorking(true);
    try {
      await trpcClient.service.updatePolicyPatch.mutate({body: preferences});
      await client.invalidateQueries({ queryKey: ['local-service'] });
    } catch (error) { toast.error(apiErrorText(error)); }
    finally { setWorking(false); }
  };
  if (!data) return <p className="text-sm text-muted-foreground">{status.error ? 'The service is reconnecting. Your drafts remain on this device.' : 'Checking the local service…'}</p>;
  if (data.phase === 'unmanaged') return <p className="text-sm text-muted-foreground">This server uses a source checkout. Managed updates are available after installing a packaged runtime.</p>;
  const disabled = working || !!update?.busy || !!status.error;
  const progress = update ? updateProgress(update) : null;

  return <div className="space-y-5 text-sm">
    <div><p>Ri {data.version}</p><p className="text-muted-foreground">The background service continues when you close the desktop app.</p></div>
    {status.error && <p role="status" className="text-muted-foreground">Reconnecting to the service. The last known update status is shown below.</p>}
    {!update?.configured ? <p className="text-muted-foreground">This build has no release publisher configured. Install a signed release to enable updates.</p> : <>
      <div className="space-y-2">
        {update.release && <p>Release {update.release.version}</p>}
        {update.release?.notes && <p className="whitespace-pre-wrap text-muted-foreground">{update.release.notes}</p>}
        <p role="status" aria-live="polite">{updateStatusText(update)}</p>
        {progress && <div className="space-y-1">
          <progress className="h-2 w-full accent-primary" max={100} value={progress.percent} aria-label="Update download" />
          <p className="text-xs text-muted-foreground">{progress.text}</p>
        </div>}
        {update.error && <p role="alert" className="text-destructive">{update.error}</p>}
      </div>
      {data.canManage ? <>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={disabled || update.phase === 'recovery-required'} onClick={() => void action({ action: 'check' })}>Check for updates</Button>
          {update.release && ['available', 'failed'].includes(update.phase) && <Button disabled={disabled} onClick={() => void action({ action: 'download' })}>{update.phase === 'failed' ? 'Retry download' : 'Download update'}</Button>}
        </div>
        {['ready', 'waiting'].includes(update.phase) && <ActivationSettings key={`${update.release?.runtime.id}:${JSON.stringify(update.window)}:${!!update.approved}`} update={update} disabled={disabled} onAction={action} />}
        {update.policy && <div className="space-y-4 rounded-lg border p-4">
          <div><p className="font-medium">Download preferences</p><p className="text-xs text-muted-foreground">{update.policy.channel === 'beta' ? 'Beta' : 'Stable'} release channel</p></div>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1"><Label htmlFor={`${id}-automatic`}>Download updates automatically</Label><p id={`${id}-automatic-help`} className="text-xs text-muted-foreground">Download verified updates after periodic checks. Installation always requires your approval.</p></div>
            <Switch id={`${id}-automatic`} checked={update.policy.automaticDownload} disabled={disabled} aria-describedby={`${id}-automatic-help`} onCheckedChange={automaticDownload => void savePreferences({ automaticDownload })} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1"><Label htmlFor={`${id}-metered`}>Limit downloads on this connection</Label><p id={`${id}-metered-help`} className="text-xs text-muted-foreground">Pause automatic downloads until you turn this off. Manual downloads are still available. Ri does not detect metered networks automatically.</p></div>
            <Switch id={`${id}-metered`} checked={update.policy.metered} disabled={disabled} aria-describedby={`${id}-metered-help`} onCheckedChange={metered => void savePreferences({ metered })} />
          </div>
          {update.policy.metered && <p className="text-xs text-muted-foreground">Automatic downloads are paused.</p>}
        </div>}
      </> : <p className="text-muted-foreground">Manage software installation from the owner’s desktop or the local CLI.</p>}
      <p className="text-muted-foreground">Updates wait for running chats and owned processes to finish. Phone and browser connections briefly reconnect. Your data is checked and backed up before migrations run.</p>
    </>}
    {data.canManage && <RuntimeSetup />}
  </div>;
}

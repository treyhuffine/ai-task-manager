'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RuntimeSetup } from '@/components/desktop/runtime-setup';
import { Button } from '@/components/ui/button';
import { api, apiErrorText } from '@/lib/api/client';
import { documentSaves } from '@/lib/client/document-saves';
import type { UpdateRecord } from '@/lib/service/update';

interface Status { phase: string; version?: string; canManage: boolean; update?: UpdateRecord & { configured: boolean; busy: boolean } }
export function UpdatesSection() {
  const client = useQueryClient();
  const [working, setWorking] = useState(false);
  const status = useQuery({ queryKey: ['local-service'], queryFn: () => api.get<Status>('/service'), refetchInterval: 2000, retry: false });
  const data = status.data;
  const update = data?.update;
  const action = async (action: string) => {
    setWorking(true);
    try {
      if (action === 'apply' || action === 'when-idle') await documentSaves.flushAll();
      await api.post('/service/update', { action });
      await client.invalidateQueries({ queryKey: ['local-service'] });
    } catch (error) { toast.error(apiErrorText(error)); }
    finally { setWorking(false); }
  };
  if (!data) return <p className="text-sm text-muted-foreground">{status.error ? 'The service is reconnecting. Your drafts remain on this device.' : 'Checking the local service…'}</p>;
  if (data.phase === 'unmanaged') return <p className="text-sm text-muted-foreground">This server uses a source checkout. Managed updates are available after installing a packaged runtime.</p>;
  return <div className="space-y-5 text-sm">
    <div><p>Ri {data.version}</p><p className="text-muted-foreground">The background service continues when you close the desktop app.</p></div>
    {!update?.configured ? <p className="text-muted-foreground">This build has no release publisher configured. Install a signed release to enable updates.</p> : <>
      <div className="space-y-2"><p>{update.release ? `Release ${update.release.version}` : 'No update selected'}</p>
        {update.release?.notes && <p className="whitespace-pre-wrap text-muted-foreground">{update.release.notes}</p>}
        <p aria-live="polite">{update.busy ? 'Working…' : update.reason ?? ({ committed: 'Updated successfully', ready: 'Downloaded and verified', waiting: 'Waiting for work to finish', available: 'Update available', failed: 'Update needs attention', 'recovery-required': 'Recovery required' } as Record<string, string>)[update.phase] ?? 'Ready to check'}</p>
        {update.phase === 'downloading' && <p>{Math.floor((update.bytes ?? 0) / 1024 ** 2)} MiB downloaded</p>}
        {update.error && <p role="alert" className="text-destructive">{update.error}</p>}
      </div>
      {data.canManage ? <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={working || update.busy} onClick={() => void action('check')}>Check for updates</Button>
        {['available', 'failed'].includes(update.phase) && <Button disabled={working || update.busy} onClick={() => void action('download')}>Download update</Button>}
        {['ready', 'waiting'].includes(update.phase) && <>
          <Button disabled={working || update.busy} onClick={() => void action('when-idle')}>Update when idle</Button>
          <Button variant="outline" disabled={working || update.busy} onClick={() => void action('apply')}>Restart and update</Button>
        </>}
        {update.phase === 'waiting' && <Button variant="ghost" disabled={working || update.busy} onClick={() => void action('later')}>Later</Button>}
      </div> : <p className="text-muted-foreground">Manage software installation from the owner’s desktop or the local CLI.</p>}
      <p className="text-muted-foreground">Updates wait for executions and owned processes to finish. Phone and browser connections briefly reconnect. Your data is checked and backed up before migrations run.</p>
    </>}
    {data.canManage && <RuntimeSetup />}
  </div>;
}

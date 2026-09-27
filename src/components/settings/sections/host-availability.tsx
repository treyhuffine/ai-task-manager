'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, apiErrorText } from '@/lib/api/client';
import type { AwakeStatus } from '@/lib/service/awake-settings';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

export function HostAvailability() {
  const client = useQueryClient(); const [busy, setBusy] = useState(false);
  const service = useQuery({ queryKey: ['local-service'], queryFn: () => api.get<{ phase: string; canManage: boolean }>('/service'), refetchInterval: 10_000, retry: false });
  const managed = !!service.data && !['unmanaged', 'stopping'].includes(service.data.phase);
  const owner = !!service.data?.canManage;
  const query = useQuery({ queryKey: ['host-availability'], queryFn: () => api.get<{ awake: AwakeStatus }>('/service/awake'), enabled: managed && owner, refetchInterval: 10_000, retry: false });
  const status = query.data?.awake;
  const change = async (enabled: boolean) => {
    setBusy(true);
    try { client.setQueryData(['host-availability'], await api.patch('/service/awake', { enabled })); }
    catch (error) { toast.error(apiErrorText(error)); }
    finally { setBusy(false); }
  };
  return <section className="space-y-3">
    <h3 className="text-[12px] font-medium">Host availability</h3>
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-sm font-medium">Keep the host awake while plugged in</p><p className="text-xs text-muted-foreground">Applies to the computer running your Ri server, including when the desktop app is closed or quit. Its screen can still sleep.</p></div>
        <Switch aria-label="Keep the host awake while plugged in" checked={status?.enabled ?? false} disabled={busy || !managed || !owner || !status || !!query.error || !!service.error || status.phase === 'unsupported'} onCheckedChange={enabled => void change(enabled)} />
      </div>
      <p role="status" className="text-xs text-muted-foreground">{service.error ? 'The service is unreachable.' : !service.data ? 'Checking the host…' : !managed ? 'A managed background service is required.' : !owner ? 'Manage this preference from the installation owner’s desktop or local CLI.' : query.error ? 'Availability status is unavailable.' : status?.detail ?? 'Checking power and sleep settings…'}</p>
      {(query.error || service.error || status?.phase === 'unavailable') && <Button variant="outline" size="sm" disabled={busy} onClick={() => { void service.refetch(); if (status && owner && !service.error) void change(status.enabled); else void query.refetch(); }}>Retry availability check</Button>}
      <p className="text-xs text-muted-foreground">Phone access also needs a working network and your remote access URL. This does not wake a shut-down computer or override closing a laptop lid.</p>
    </div>
  </section>;
}

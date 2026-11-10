'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { RiDesktop } from '@/lib/client/desktop';
import type { DesktopDeviceSettingsAction } from '@/lib/client/desktop-device-settings';
import { DesktopPreferenceControls } from './desktop-settings';
import { openSettings } from '../settings-store';

/** Talks to this window's local shell, never the Home's HTTP service. */
export function DesktopDeviceSettings({ desktop }: { desktop: RiDesktop }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const query = useQuery({ queryKey: ['desktop-device-settings'], queryFn: () => desktop.deviceSettings!({ type: 'status' }), refetchInterval: 5000, retry: false });
  const change = async (action: DesktopDeviceSettingsAction) => {
    setBusy(true); setError('');
    try {
      client.setQueryData(['desktop-device-settings'], await desktop.deviceSettings!(action));
      void client.invalidateQueries({ queryKey: ['devices'] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The desktop setting could not be changed. Try again.'); }
    finally { setBusy(false); }
  };
  const state = query.data;
  if (!state) return <div className="space-y-3 text-sm">
    <p role={query.error ? 'alert' : 'status'}>{query.error ? 'Could not read this computer’s desktop settings.' : 'Reading this computer’s desktop settings…'}</p>
    {query.error && <Button variant="outline" onClick={() => void query.refetch()}>Retry</Button>}
  </div>;
  const remote = state.role === 'worker' || state.role === 'viewer';
  const blocked = busy || !!query.error;
  const worker = state.worker;
  const update = state.update;
  const workerText = state.role === 'home' ? 'Your agents run on this computer.' : state.role === 'viewer' ? 'Local execution is off.' : worker?.state === 'connected' ? 'Connected. This computer can run agents.' : worker?.state === 'update-required' ? 'Update required before agents can run here.' : worker?.enabled === false ? 'Local execution is stopped.' : worker ? `Local execution: ${worker.state}` : 'Checking local execution…';

  return <div className="space-y-5">
    <div className="space-y-1 text-sm">
      <p className="font-medium">Desktop {state.appVersion}{state.runtimeVersion ? ` · Runtime ${state.runtimeVersion}` : ''}</p>
      <p className="text-xs text-muted-foreground">These settings apply to the computer showing this window.</p>
    </div>
    {(error || query.error) && <p role="alert" className="text-xs text-destructive">{error || 'Desktop settings could not refresh. Try again.'} <button type="button" className="underline" onClick={() => void query.refetch()}>Refresh status</button></p>}
    <section aria-label="Agents on this computer" className="space-y-3 rounded-lg border border-border p-3">
      <h3 className="text-sm font-medium">Agents on this computer</h3>
      <p role="status" className="text-sm">{workerText}</p>
      {(worker?.error || worker?.reason) && <p className="text-xs text-muted-foreground">{worker.error || worker.reason}</p>}
      <p className="text-xs text-muted-foreground">Local agents use the project folders, tools, and sign-ins on this computer.</p>
      {remote && <Button variant="outline" size="sm" disabled={blocked || !state.serviceAvailable} onClick={() => void change({ type: state.role === 'viewer' ? 'enable-worker' : worker?.enabled === false ? 'resume-worker' : 'stop-worker' })}>
        {state.role === 'viewer' ? 'Enable local execution' : worker?.enabled === false ? 'Resume local execution' : 'Stop local execution'}
      </Button>}
    </section>
    {state.preferences && <DesktopPreferenceControls status={state.preferences} busy={blocked} save={value => change({ type: 'preferences', value })} />}
    <section aria-label="Background service" className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div><h3 className="text-sm font-medium">Keep Ri running when I log in</h3><p className="text-xs text-muted-foreground">Start this computer’s background service at login, even when the desktop window is closed.</p></div>
        <Switch aria-label="Start this computer’s service at login" checked={state.startsAtLogin} disabled={blocked || !state.serviceAvailable} onCheckedChange={enabled => void change({ type: 'login', enabled })} />
      </div>
    </section>
    <section aria-label="Updates on this computer" className="space-y-3 rounded-lg border border-border p-3">
      <h3 className="text-sm font-medium">Updates on this computer</h3>
      {!update?.configured ? <div className="space-y-2 text-xs text-muted-foreground"><p>This build updates manually. The desktop app and background runtime update separately.</p><p>Update the runtime from a Ri checkout with <code>ri update --from &lt;checkout&gt;</code>. Rebuild and install Ri.app to update the desktop app. Your saved connection and local agent setup are kept.</p></div> : <>
        <p role="status" className="text-xs text-muted-foreground">{update.error || update.reason || `Update ${update.phase}`}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={blocked} onClick={() => void change({ type: 'update-check' })}>Check for updates</Button>
          {update.phase === 'available' && <Button size="sm" disabled={blocked} onClick={() => void change({ type: 'update-download' })}>Download update</Button>}
          {['ready', 'waiting'].includes(update.phase) && <Button size="sm" disabled={blocked} onClick={() => void change({ type: 'update-apply' })}>Update when idle</Button>}
          {!['idle', 'committed'].includes(update.phase) && <Button variant="ghost" size="sm" disabled={blocked} onClick={() => void change({ type: 'update-later' })}>Later</Button>}
        </div>
      </>}
    </section>
    <section aria-label="This computer’s connection" className="space-y-3 rounded-lg border border-border p-3">
      <h3 className="text-sm font-medium">Connection</h3>
      <p className="text-xs text-muted-foreground">{remote ? `Connected to ${state.home?.name ?? 'your Ri'}${state.home?.hostName ? ` on ${state.home.hostName}` : ''}. Your data stays there.` : 'Your Ri lives on this computer.'}</p>
      <div className="flex flex-wrap gap-2">
        {remote && <Button variant="outline" size="sm" disabled={blocked} onClick={() => void change({ type: 'connection' })}>Change connection</Button>}
        <Button variant="outline" size="sm" onClick={() => openSettings('notifications')}>Notification settings</Button>
        <Button variant="ghost" size="sm" disabled={blocked} onClick={() => void change({ type: 'recovery' })}>Installation and recovery</Button>
      </div>
    </section>
  </div>;
}

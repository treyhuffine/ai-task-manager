'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { apiErrorText } from '@/lib/api/client';
import type { DesktopSettingsAction, DesktopSettingsStatus } from '@/lib/client/desktop-settings';
import type { RiDesktop } from '@/lib/client/desktop';

function ShortcutForm({ status, busy, save }: { status: DesktopSettingsStatus['shortcut']; busy: boolean; save(action: DesktopSettingsAction): Promise<void> }) {
  const [accelerator, setAccelerator] = useState(status.accelerator);
  return <div className="space-y-3 rounded-lg border p-3">
    <div className="flex items-center justify-between gap-3">
      <div><p className="text-sm font-medium">Capture from any app</p><p className="text-xs text-muted-foreground">Open Quick Capture while Ri runs in the menu bar. Your current document stays open.</p></div>
      <Switch aria-label="Global Quick Capture" disabled={busy} checked={status.enabled} onCheckedChange={enabled => void save({ type: 'shortcut', enabled, accelerator: enabled ? accelerator : status.accelerator })} />
    </div>
    <label className="block text-xs font-medium" htmlFor="desktop-capture-shortcut">Keyboard shortcut</label>
    <div className="flex gap-2">
      <Input id="desktop-capture-shortcut" value={accelerator} onChange={event => setAccelerator(event.target.value)} disabled={busy} autoComplete="off" spellCheck={false} />
      <Button variant="outline" disabled={busy} onClick={() => void save({ type: 'shortcut', enabled: status.enabled, accelerator })}>{status.state === 'unavailable' ? 'Retry' : 'Save shortcut'}</Button>
    </div>
    <p className="text-xs text-muted-foreground">CommandOrControl uses Command on Mac and Control on Linux. Add Shift or Alt, then a key, such as CommandOrControl+Shift+K.</p>
    <p role="status" className="text-xs text-muted-foreground">{status.detail ?? (status.state === 'active' ? 'Shortcut registered. Quick Capture is also available in the Ri menu.' : 'Global shortcut is off. Quick Capture is still available in Ri.')}</p>
  </div>;
}

export function DesktopSettings() {
  const [desktop, setDesktop] = useState<RiDesktop>();
  useEffect(() => setDesktop(window.riDesktop?.settings ? window.riDesktop : undefined), []);
  const client = useQueryClient(); const [busy, setBusy] = useState(false);
  const query = useQuery({ queryKey: ['desktop-settings'], queryFn: () => desktop!.settings!({ type: 'status' }), enabled: !!desktop, refetchInterval: 5000, retry: false });
  if (!desktop) return null;
  const save = async (action: DesktopSettingsAction) => {
    setBusy(true);
    try {
      const result = await desktop.settings!(action);
      client.setQueryData(['desktop-settings'], result);
      if (action.type === 'login' && ['error', 'unavailable', 'conflict'].includes(result.login.state)) toast.error(result.login.detail ?? 'Login setup could not be changed.');
    }
    catch (error) { toast.error(apiErrorText(error)); void query.refetch(); }
    finally { setBusy(false); }
  };
  const status = query.data;
  return <section className="space-y-3">
    <h3 className="text-[12px] font-medium">Desktop</h3>
    {query.error && <p role="alert" className="text-xs text-destructive">Desktop settings are unavailable. <button className="underline" onClick={() => void query.refetch()}>Retry</button></p>}
    {!status ? <p className="text-xs text-muted-foreground">Reading desktop settings…</p> : <>
      <ShortcutForm key={`${status.shortcut.enabled}:${status.shortcut.accelerator}`} status={status.shortcut} busy={busy || !!query.error} save={save} />
      <div className="space-y-2 rounded-lg border p-3">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-sm font-medium">Open Ri quietly when I log in</p><p className="text-xs text-muted-foreground">Start in the menu bar so native notifications and your capture shortcut are available.</p></div>
          <Switch aria-label="Open Ri at login" disabled={busy || !!query.error || !status.login.supported} checked={status.login.enabled} onCheckedChange={enabled => void save({ type: 'login', enabled })} />
        </div>
        <p role="status" className="text-xs text-muted-foreground">{status.login.detail ?? (status.login.enabled ? 'Ri is registered to open at login.' : 'Ri will open when you launch it.')}</p>
        {['moved', 'requires-approval', 'error'].includes(status.login.state) && <Button variant="outline" size="sm" disabled={busy} onClick={() => void save({ type: 'login', enabled: true })}>Retry login setup</Button>}
        {status.login.state === 'requires-approval' && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save({ type: 'login', enabled: false })}>Cancel login setup</Button>}
        <p className="text-xs text-muted-foreground">This controls the desktop app. Background service startup is managed separately in the Tools menu.</p>
      </div>
    </>}
  </section>;
}

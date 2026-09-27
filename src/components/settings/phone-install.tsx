'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Download, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { APP_NAME } from '@/constants/app';
import { promptWebAppInstall, startWebAppInstall, useWebAppInstall } from '@/lib/client/web-app-install';
import { setSettingsSection } from './settings-store';

/** Mounted once so Chromium's install event survives opening settings later. */
export function WebAppBootstrap() {
  useEffect(() => { startWebAppInstall(); }, []);
  return null;
}

export function PhoneInstall() {
  const install = useWebAppInstall();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const prompt = async () => {
    setBusy(true);
    setMessage('');
    try {
      const outcome = await promptWebAppInstall();
      setMessage(outcome === 'accepted'
        ? 'Installation accepted. Open Ri from your home screen or app launcher.'
        : 'You can install later from your browser menu.');
    } catch {
      setMessage('The browser could not open installation. Use its menu to install Ri instead.');
    } finally { setBusy(false); }
  };

  return (
    <section className="space-y-3" aria-labelledby="phone-install-title">
      <div className="flex items-center gap-2">
        <Smartphone size={14} className="text-muted-foreground" />
        <h3 id="phone-install-title" className="text-sm font-medium">{APP_NAME} on your phone</h3>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Open your remote HTTPS URL on your phone, pair that device, then add Ri to its home screen.
        Keep using the same URL so this device keeps its sign-in and drafts.
      </p>
      {install.ready && !install.secure && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs">
          This connection is not secure. Open your HTTPS remote URL to install Ri and use microphone access and browser notifications.
        </p>
      )}
      {install.installed && !install.desktop ? (
        <p className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 size={14} /> Ri is running as an installed web app on this device.
        </p>
      ) : (
        <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">
          <div>
            <p className="font-medium">iPhone and iPad</p>
            <p className="mt-1 leading-relaxed text-muted-foreground">
              Open Ri in Safari, tap Share, then Add to Home Screen. If shown, leave Open as Web App enabled.
              Open the new icon before enabling notifications.
            </p>
          </div>
          <div>
            <p className="font-medium">Android</p>
            <p className="mt-1 leading-relaxed text-muted-foreground">
              Open Ri in Chrome, then choose Install app or Add to Home screen from the browser menu.
            </p>
          </div>
          {install.canPrompt && install.secure && !install.desktop && (
            <Button variant="outline" size="sm" onClick={() => void prompt()} disabled={busy}>
              <Download size={14} /> {busy ? 'Opening installation…' : 'Install Ri on this device'}
            </Button>
          )}
        </div>
      )}
      {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Your Ri computer and remote connection must stay running and reachable. Installing the phone app
        does not keep that computer awake or copy its database to your phone. If a connection fails, reconnect
        before continuing. Drafts already saved on this device stay here unless browser data is cleared.
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        If the installed app asks to pair again, create a device pairing link on your Ri computer.
        Browser and installed-app storage can be separate.
      </p>
      <Button size="sm" variant="outline" onClick={() => setSettingsSection('notifications')}>Set up notifications</Button>
    </section>
  );
}

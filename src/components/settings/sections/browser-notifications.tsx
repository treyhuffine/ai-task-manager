'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Globe, Loader2 } from 'lucide-react';
import type { NotificationChannelRecord } from '@/db/types';
import { apiErrorText } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { setSettingsSection } from '@/components/settings/settings-store';
import {
  getBrowserPushStatus, subscribeToWebPush, unsubscribeFromWebPush, type BrowserPushStatus,
} from '@/lib/notifications/web-push-client';

interface Props {
  channel?: NotificationChannelRecord | null;
  onChanged?: () => void | Promise<void>;
}

/** Device registration is separate from the shared channel's routing preferences. */
export function BrowserNotifications({ channel, onChanged }: Props) {
  const [status, setStatus] = useState<BrowserPushStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const sequence = useRef(0);
  const acting = useRef(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    setChecking(true);
    try {
      const next = await getBrowserPushStatus();
      if (mounted.current && current === sequence.current) { setStatus(next); setReadError(null); }
    } catch (error) {
      if (mounted.current && current === sequence.current) {
        setStatus(null);
        setReadError(`Could not check browser notifications. ${apiErrorText(error)}`);
      }
    } finally { if (mounted.current && current === sequence.current) setChecking(false); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const check = () => { if (!acting.current) void refresh(); };
    const visible = () => { if (document.visibilityState === 'visible') check(); };
    let permission: PermissionStatus | undefined;
    let disposed = false;
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', visible);
    // Browsers without the Permissions API still refresh when the user returns
    // from site settings. Reading permission never asks the user to opt in.
    if (navigator.permissions?.query) {
      void navigator.permissions.query({ name: 'notifications' }).then(value => {
        if (disposed) return;
        permission = value;
        permission.addEventListener('change', check);
      }).catch(() => {});
    }
    return () => {
      disposed = true; mounted.current = false;
      // Invalidate every read still running. This ref is a counter, not a DOM node.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      sequence.current++;
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', visible);
      permission?.removeEventListener('change', check);
    };
  }, [refresh]);

  // A parent channel toggle or removal must immediately replace old preferences.
  // Re-read the server too, so a later response cannot revive deleted routing.
  useEffect(() => { if (!acting.current) void refresh(); }, [channel, refresh]);

  const act = async (action: () => Promise<void>) => {
    if (acting.current) return;
    acting.current = true; sequence.current++; setBusy(true); setActionError(null);
    try {
      await action();
      await onChanged?.();
    } catch (error) { if (mounted.current) setActionError(apiErrorText(error)); }
    finally {
      if (mounted.current) { await refresh(); setBusy(false); }
      acting.current = false;
    }
  };

  // The last successful status read is authoritative, including changes made
  // in another tab. Parent preferences trigger a fresh read, never override it.
  const currentChannel = status?.channel;
  const blocked = status?.permission === 'denied';
  const repair = !!status?.localSubscription && (!status.registered || status.expired || !currentChannel);
  const allowed = !!status?.supported && !blocked;
  let title = 'Checking browser notifications';
  let detail = 'Checking this browser and its registration with Ri.';
  if (!checking && readError) {
    title = 'Browser notification status is unavailable'; detail = 'Reconnect to Ri and check again.';
  } else if (!checking && status) {
    if (!status.supported) {
      title = 'Browser push is unavailable here'; detail = 'On iPhone or iPad, open Ri from its home-screen icon first.';
    } else if (blocked) {
      title = 'Notifications are blocked'; detail = 'Allow notifications in your browser site settings, then check again.';
    } else if (status.permission !== 'granted' || !status.localSubscription) {
      title = 'Browser notifications are off'; detail = 'Enable notifications on this device when you want Ri to reach you here.';
    } else if (repair) {
      title = 'Browser notifications need repair'; detail = 'Ri cannot confirm this browser registration. Repair keeps your existing channel preferences.';
    } else if (!currentChannel?.enabled) {
      title = 'Browser registered, delivery paused'; detail = 'The Web push channel is off. Turn it on below when you want notifications. Your event choices are kept.';
    } else if (!currentChannel.events.length) {
      title = 'Browser notifications are ready'; detail = 'No event types are selected. Choose events below or use this channel for scheduled results.';
    } else {
      title = 'Browser push on for this device'; detail = 'This browser is registered with Ri. Choose which events reach it below.';
    }
  }

  return <section aria-label="Browser notifications" className="rounded-xl border border-border bg-card/30 p-3">
    <div className="flex items-center gap-2 text-xs font-semibold"><Globe size={16} />{title}{(checking || busy) && <Loader2 size={12} className="animate-spin" />}</div>
    <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
    {(actionError || readError) && <p role="alert" className="mt-2 text-xs text-destructive">{actionError || readError}</p>}
    <div className="mt-2 flex flex-wrap gap-2">
      {allowed && status && (!status.localSubscription || repair || status.permission !== 'granted') && <Button size="xs" disabled={busy || checking} onClick={() => void act(subscribeToWebPush)}>
        {repair ? 'Repair browser notifications' : 'Enable browser push'}
      </Button>}
      {status?.localSubscription && <Button size="xs" variant="ghost" disabled={busy || checking} onClick={() => void act(unsubscribeFromWebPush)}>Turn off here</Button>}
      {status && !status.supported && <Button size="xs" variant="ghost" onClick={() => setSettingsSection('devices')}>Phone setup</Button>}
      <Button size="xs" variant="ghost" disabled={busy || checking} onClick={() => { setActionError(null); void refresh(); }}>Check again</Button>
    </div>
  </section>;
}
